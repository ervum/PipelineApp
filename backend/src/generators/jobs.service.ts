import {
  ApprovalStatus,
  AssetFileRole,
  AssetModel,
  BatchMatrixJobDto,
  CreateArenaJobDto,
  CreateDialogueSceneDto,
  CreateJobDto,
  ErrorCode,
  ExecutionMode,
  ExecutionTier,
  GenerationSubMode,
  JobEventModel,
  JobListQueryDto,
  JobModel,
  JobStatus,
  Modality,
  ModalityParams,
  Paginated,
  ProviderKind,
  RecompileDto,
  RunPipelineDto,
  SEED_MAX,
  TERMINAL_JOB_STATUSES,
  UpdateCompiledDto,
} from '@forge/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toAssetModel } from '../common/mappers/asset.mapper';
import {
  GenerationJobWithRelations,
  toJobEventModel,
  toJobModel,
} from '../common/mappers/job.mapper';
import {
  JOB_EVENTS_PUBLISHER,
  JobEventsPublisherPort,
} from '../orchestrator/job-events.port';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { StorageKeys } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import {
  parseDialogueScript,
  synthesizeDialogueScene,
} from '../synth/wav-audio.synth';
import { GeneratorAdapterRegistry } from './generator-adapter.registry';
import { JobProcessorService } from './job-processor.service';
import { JobStateService } from './job-state.service';

const JOB_RELATIONS_INCLUDE = {
  providerConfig: {
    select: {
      id: true,
      name: true,
      kind: true,
    },
  },
  middlemanProfile: {
    select: {
      id: true,
      name: true,
    },
  },
  assets: {
    select: {
      id: true,
    },
  },
} as const;

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
    private readonly adapterRegistry: GeneratorAdapterRegistry,
    private readonly jobState: JobStateService,
    private readonly processor: JobProcessorService,
    private readonly storage: StorageService,
    @Inject(JOB_EVENTS_PUBLISHER)
    private readonly eventsPublisher: JobEventsPublisherPort,
  ) {}

  async create(dto: CreateJobDto): Promise<JobModel> {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });
    if (!project) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Project not found: ${dto.projectId}`,
      );
    }

    const provider = await this.providersService.getRuntimeConfig(
      dto.providerConfigId,
    );
    if (!provider.isEnabled) {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        `Provider "${provider.name}" is disabled`,
      );
    }

    const modality = dto.params.modality as Modality;
    if (!provider.modalities.includes(modality)) {
      throw new DomainError(
        ErrorCode.MODALITY_UNSUPPORTED,
        400,
        `Provider "${provider.name}" does not support modality "${modality}"`,
      );
    }

    // 5.3 Monthly budget cap check
    if (
      typeof provider.settings.monthlyBudgetUsd === 'number' &&
      provider.settings.monthlyBudgetUsd > 0 &&
      typeof this.prisma.generationJob?.aggregate === 'function'
    ) {
      const now = new Date();
      const monthStart = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
      );
      const spent = await this.prisma.generationJob.aggregate({
        where: {
          providerConfigId: provider.id,
          createdAt: { gte: monthStart },
        },
        _sum: { costUsd: true },
      });
      const spentUsd = spent._sum.costUsd ?? 0;
      if (spentUsd >= provider.settings.monthlyBudgetUsd) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          402,
          `Provider "${provider.name}" has reached its monthly budget cap ($${spentUsd.toFixed(2)} / $${provider.settings.monthlyBudgetUsd.toFixed(2)})`,
        );
      }
    }

    const subMode =
      'subMode' in dto.params
        ? (dto.params.subMode as GenerationSubMode)
        : GenerationSubMode.STANDARD;

    // Verify adapter exists for (kind, modality, subMode)
    this.adapterRegistry.resolve(provider.kind, modality, subMode);

    // Voice profile check
    if (dto.params.modality === Modality.VOICES) {
      const exemptKinds = new Set<ProviderKind>([
        ProviderKind.DEMO,
        ProviderKind.GOOGLE_WEB,
        ProviderKind.GENERIC_HTTP,
        ProviderKind.RUNPOD_SERVERLESS,
      ]);
      const voiceProfileId = dto.params.voiceProfileId;
      if (voiceProfileId) {
        const vp = await this.prisma.voiceProfile.findUnique({
          where: { id: voiceProfileId },
        });
        if (!vp || vp.projectId !== project.id) {
          throw new DomainError(
            ErrorCode.NOT_FOUND,
            404,
            `Voice profile not found in project: ${voiceProfileId}`,
          );
        }
        if (
          !exemptKinds.has(provider.kind) &&
          (!vp.externalVoiceId || vp.externalVoiceId.trim().length === 0)
        ) {
          throw new DomainError(
            ErrorCode.VALIDATION_FAILED,
            400,
            `Voice profile "${vp.name}" is missing an externalVoiceId for provider "${provider.name}"`,
          );
        }
      } else if (!exemptKinds.has(provider.kind)) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          400,
          `Voice generation with provider "${provider.name}" requires a voiceProfileId with externalVoiceId`,
        );
      }
    }

    const referenceStorageKeys: string[] = [];
    if (
      'referenceStorageKey' in dto.params &&
      typeof dto.params.referenceStorageKey === 'string' &&
      dto.params.referenceStorageKey.length > 0
    ) {
      const refKey = dto.params.referenceStorageKey;
      const expectedPrefix = `projects/${project.slug}/`;
      if (!refKey.startsWith(expectedPrefix)) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          400,
          `referenceStorageKey must belong to project "${project.slug}"`,
        );
      }
      const stat = await this.storage.stat(refKey);
      if (!stat) {
        throw new DomainError(
          ErrorCode.NOT_FOUND,
          404,
          `Reference file not found in storage: ${refKey}`,
        );
      }
      referenceStorageKeys.push(refKey);
    }

    const batchCount =
      'batchCount' in dto.params && typeof dto.params.batchCount === 'number'
        ? Math.max(1, dto.params.batchCount)
        : 'variationCount' in dto.params &&
            typeof dto.params.variationCount === 'number'
          ? Math.max(1, dto.params.variationCount)
          : 1;

    const mergedUserParams: Record<string, unknown> = {
      ...dto.params,
      advanced: dto.advanced ?? {},
      ...(dto.parentAssetId ? { __parentAssetId: dto.parentAssetId } : {}),
    };

    const seed =
      'seed' in dto.params && typeof dto.params.seed === 'number'
        ? dto.params.seed
        : Math.floor(Math.random() * SEED_MAX);

    const maxAttempts =
      provider.settings.autoRetry === false
        ? 1
        : Math.max(1, Math.min(10, provider.settings.maxAttempts ?? 3));

    const created = await this.prisma.$transaction(async (tx) => {
      const job = await tx.generationJob.create({
        data: {
          projectId: project.id,
          modality,
          subMode,
          executionMode: dto.executionMode as ExecutionMode,
          status: JobStatus.QUEUED,
          rawPrompt: dto.rawPrompt,
          pinnedFileIds: dto.pinnedFileIds,
          referenceStorageKeys,
          userParams: mergedUserParams as Prisma.InputJsonValue,
          middlemanProfileId: dto.middlemanProfileId ?? null,
          skipMiddleman: dto.skipMiddleman,
          providerConfigId: provider.id,
          providerModel: dto.providerModel ?? provider.defaultModel,
          tier: provider.tier,
          seed,
          batchCount,
          maxAttempts,
        },
        include: JOB_RELATIONS_INCLUDE,
      });

      await tx.generationJobEvent.create({
        data: {
          jobId: job.id,
          type: 'created',
          fromStatus: null,
          toStatus: JobStatus.QUEUED,
          message: `Job created (${modality}/${subMode}, mode=${dto.executionMode})`,
        },
      });

      return job;
    });

    const model = toJobModel(created);
    this.eventsPublisher.jobCreated({ job: model });
    void this.processor.tick();
    return model;
  }

  async get(id: string): Promise<JobModel> {
    const row = await this.findOrThrow(id);
    return toJobModel(row);
  }

  async list(query: JobListQueryDto): Promise<Paginated<JobModel>> {
    const where: Prisma.GenerationJobWhereInput = {
      projectId: query.projectId,
    };

    if (query.modality) {
      where.modality = query.modality;
    }

    if (query.status && query.status.length > 0) {
      where.status = { in: query.status as JobStatus[] };
    } else if (query.active === 'true') {
      where.status = { notIn: Array.from(TERMINAL_JOB_STATUSES) };
    } else if (query.active === 'false') {
      where.status = { in: Array.from(TERMINAL_JOB_STATUSES) };
    }

    const limit = query.limit ?? 30;
    const [rows, total] = await Promise.all([
      this.prisma.generationJob.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(query.cursor
          ? {
              cursor: { id: query.cursor },
              skip: 1,
            }
          : {}),
        include: JOB_RELATIONS_INCLUDE,
      }),
      this.prisma.generationJob.count({ where }),
    ]);

    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map((r) =>
      toJobModel(r),
    );
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return { items, nextCursor, total };
  }

  async events(id: string): Promise<JobEventModel[]> {
    await this.findOrThrow(id);
    const rows = await this.prisma.generationJobEvent.findMany({
      where: { jobId: id },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toJobEventModel);
  }

  async updateCompiled(
    id: string,
    dto: UpdateCompiledDto,
  ): Promise<JobModel> {
    const existing = await this.findOrThrow(id);
    if (existing.status !== JobStatus.AWAITING_REVIEW) {
      throw new DomainError(
        ErrorCode.INVALID_TRANSITION,
        409,
        `Cannot edit compiled payload when job status is ${existing.status} (must be AWAITING_REVIEW)`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.generationJob.update({
        where: { id },
        data: {
          editedPayload: dto.compiled as unknown as Prisma.InputJsonValue,
        },
        include: JOB_RELATIONS_INCLUDE,
      });

      await tx.generationJobEvent.create({
        data: {
          jobId: id,
          type: 'compiled-edited',
          fromStatus: JobStatus.AWAITING_REVIEW,
          toStatus: JobStatus.AWAITING_REVIEW,
          message: 'User edited compiled prompt payload',
        },
      });

      return row;
    });

    return toJobModel(updated);
  }

  async recompile(id: string, dto: RecompileDto): Promise<JobModel> {
    const existing = await this.findOrThrow(id);
    if (existing.status !== JobStatus.AWAITING_REVIEW) {
      throw new DomainError(
        ErrorCode.INVALID_TRANSITION,
        409,
        `Cannot recompile job in status ${existing.status} (must be AWAITING_REVIEW)`,
      );
    }

    await this.jobState.transition(
      id,
      JobStatus.COMPILING,
      {
        ...(dto.rawPrompt !== undefined ? { rawPrompt: dto.rawPrompt } : {}),
        ...(dto.pinnedFileIds !== undefined
          ? { pinnedFileIds: dto.pinnedFileIds }
          : {}),
        editedPayload: Prisma.DbNull,
      },
      'Recompiling prompt with Middleman',
    );

    void this.processor.tick();
    return this.get(id);
  }

  async dispatch(id: string): Promise<JobModel> {
    const existing = await this.findOrThrow(id);
    if (existing.status !== JobStatus.AWAITING_REVIEW) {
      throw new DomainError(
        ErrorCode.INVALID_TRANSITION,
        409,
        `Cannot dispatch job in status ${existing.status} (must be AWAITING_REVIEW)`,
      );
    }

    await this.jobState.transition(
      id,
      JobStatus.READY,
      {},
      'Approved in Prompt Interceptor; queued for generator dispatch',
    );

    void this.processor.tick();
    return this.get(id);
  }

  async cancel(id: string): Promise<JobModel> {
    const existing = await this.findOrThrow(id);
    const currentStatus = existing.status as JobStatus;
    if (TERMINAL_JOB_STATUSES.includes(currentStatus)) {
      throw new DomainError(
        ErrorCode.INVALID_TRANSITION,
        409,
        `Cannot cancel job already in terminal status ${currentStatus}`,
      );
    }

    this.processor.cancelInflight(id);

    await this.jobState.transition(
      id,
      JobStatus.CANCELLED,
      {},
      'Job cancelled by user',
    );

    if (
      existing.remoteHandle !== null &&
      typeof existing.remoteHandle === 'object'
    ) {
      try {
        const provider = await this.providersService.getRuntimeConfig(
          existing.providerConfigId,
        );
        const adapter = this.adapterRegistry.resolve(
          provider.kind,
          existing.modality as Modality,
          existing.subMode as GenerationSubMode,
        );
        if (adapter.cancel) {
          const project = await this.prisma.project.findUnique({
            where: { id: existing.projectId },
          });
          if (project) {
            await adapter.cancel(
              {
                job: existing,
                project,
                provider,
                modality: existing.modality as Modality,
                subMode: existing.subMode as GenerationSubMode,
                params: existing.userParams as unknown as ModalityParams,
                compiled: {
                  assetTitle: 'Cancelled',
                  enhancedPrompt: existing.rawPrompt,
                  negativePrompt: '',
                  recommendedParams: {},
                  contextSourcesUsed: [],
                  warnings: [],
                },
                mergedParams: {},
                seed: existing.seed ?? 0,
                references: [],
                voiceProfile: null,
                webhookUrl: null,
                signal: new AbortController().signal,
                reportProgress: () => undefined,
                reportWorker: () => undefined,
                log: () => undefined,
              },
              existing.remoteHandle as Record<string, unknown>,
            );
          }
        }
      } catch {
        // Best-effort remote cancellation
      }
    }

    return this.get(id);
  }

  async retry(id: string): Promise<JobModel> {
    const existing = await this.findOrThrow(id);
    if (existing.status !== JobStatus.FAILED) {
      throw new DomainError(
        ErrorCode.INVALID_TRANSITION,
        409,
        `Cannot retry job in status ${existing.status} (must be FAILED)`,
      );
    }

    await this.jobState.transition(
      id,
      JobStatus.QUEUED,
      {
        attempt: { increment: 1 },
        notBefore: null,
        errorCode: null,
        errorMessage: null,
        completedAt: null,
        progressPercent: 0,
        progressStage: null,
      },
      `Retrying failed job (attempt ${existing.attempt + 1})`,
    );

    void this.processor.tick();
    return this.get(id);
  }

  async duplicate(id: string): Promise<JobModel> {
    const existing = await this.findOrThrow(id);
    const newSeed = Math.floor(Math.random() * SEED_MAX);

    const rawParams =
      typeof existing.userParams === 'object' && existing.userParams !== null
        ? { ...(existing.userParams as Record<string, unknown>), seed: newSeed }
        : { modality: existing.modality, seed: newSeed };

    const created = await this.prisma.$transaction(async (tx) => {
      const job = await tx.generationJob.create({
        data: {
          projectId: existing.projectId,
          modality: existing.modality,
          subMode: existing.subMode,
          executionMode: existing.executionMode,
          status: JobStatus.QUEUED,
          rawPrompt: existing.rawPrompt,
          pinnedFileIds: existing.pinnedFileIds,
          referenceStorageKeys: existing.referenceStorageKeys,
          userParams: rawParams as Prisma.InputJsonValue,
          middlemanProfileId: existing.middlemanProfileId,
          skipMiddleman: existing.skipMiddleman,
          providerConfigId: existing.providerConfigId,
          providerModel: existing.providerModel,
          tier: existing.tier,
          seed: newSeed,
          batchCount: existing.batchCount,
          parentJobId: existing.id,
        },
        include: JOB_RELATIONS_INCLUDE,
      });

      await tx.generationJobEvent.create({
        data: {
          jobId: job.id,
          type: 'created',
          fromStatus: null,
          toStatus: JobStatus.QUEUED,
          message: `Duplicated from job ${existing.id}`,
        },
      });

      return job;
    });

    const model = toJobModel(created);
    this.eventsPublisher.jobCreated({ job: model });
    void this.processor.tick();
    return model;
  }

  /**
   * 5.2 Multi-Provider Arena: dispatches 2..4 parallel jobs across competing providers/models
   * with a shared seed and arenaGroupId for side-by-side comparison.
   */
  async createArena(
    dto: CreateArenaJobDto,
  ): Promise<{ arenaGroupId: string; jobs: JobModel[] }> {
    const arenaGroupId = `arn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const sharedSeed =
      'seed' in dto.params && typeof dto.params.seed === 'number'
        ? dto.params.seed
        : Math.floor(Math.random() * SEED_MAX);

    const jobs: JobModel[] = [];
    for (const target of dto.providerTargets) {
      const job = await this.create({
        projectId: dto.projectId,
        executionMode: dto.executionMode,
        rawPrompt: dto.rawPrompt,
        pinnedFileIds: dto.pinnedFileIds,
        params: {
          ...dto.params,
          seed: sharedSeed,
        } as ModalityParams,
        advanced: { __arenaGroupId: arenaGroupId },
        providerConfigId: target.providerConfigId,
        providerModel: target.providerModel ?? null,
        middlemanProfileId: dto.middlemanProfileId ?? null,
        skipMiddleman: dto.skipMiddleman ?? false,
        parentAssetId: null,
      });
      jobs.push(job);
    }

    return { arenaGroupId, jobs };
  }

  /**
   * 5.3 Cost, Latency & Token Analytics Summary across modalities, providers, and daily timeline.
   */
  async getAnalyticsSummary(projectId?: string, days = 30): Promise<{
    totalJobs: number;
    completedJobs: number;
    failedJobs: number;
    totalCostUsd: number;
    avgExecutionMs: number;
    avgQueueDelayMs: number;
    avgColdStartMs: number;
    byModality: Array<{
      modality: string;
      jobCount: number;
      completedCount: number;
      costUsd: number;
      avgExecutionMs: number;
    }>;
    byProvider: Array<{
      providerConfigId: string;
      providerName: string;
      jobCount: number;
      successRate: number;
      costUsd: number;
      avgExecutionMs: number;
      monthlyBudgetUsd: number | null;
    }>;
    dailySeries: Array<{
      date: string;
      jobCount: number;
      costUsd: number;
    }>;
  }> {
    const since = new Date(Date.now() - Math.max(1, days) * 86_400_000);
    const where: Prisma.GenerationJobWhereInput = {
      createdAt: { gte: since },
      ...(projectId ? { projectId } : {}),
    };

    const [jobs, providers] = await Promise.all([
      this.prisma.generationJob.findMany({
        where,
        select: {
          id: true,
          modality: true,
          status: true,
          providerConfigId: true,
          costUsd: true,
          executionMs: true,
          queueDelayMs: true,
          coldStartMs: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.aiProviderConfig.findMany({
        select: {
          id: true,
          name: true,
          settings: true,
        },
      }),
    ]);

    const providerMap = new Map(providers.map((p) => [p.id, p]));

    let completedJobs = 0;
    let failedJobs = 0;
    let totalCostUsd = 0;
    let execSum = 0;
    let execCount = 0;
    let queueSum = 0;
    let queueCount = 0;
    let coldSum = 0;
    let coldCount = 0;

    const modMap = new Map<
      string,
      {
        jobCount: number;
        completedCount: number;
        costUsd: number;
        execSum: number;
        execCount: number;
      }
    >();
    const provStats = new Map<
      string,
      {
        jobCount: number;
        completedCount: number;
        costUsd: number;
        execSum: number;
        execCount: number;
      }
    >();
    const dailyMap = new Map<string, { jobCount: number; costUsd: number }>();

    for (const j of jobs) {
      const cost = j.costUsd ?? 0;
      totalCostUsd += cost;
      if (j.status === JobStatus.COMPLETED) completedJobs++;
      if (j.status === JobStatus.FAILED) failedJobs++;

      if (typeof j.executionMs === 'number' && j.executionMs > 0) {
        execSum += j.executionMs;
        execCount++;
      }
      if (typeof j.queueDelayMs === 'number' && j.queueDelayMs >= 0) {
        queueSum += j.queueDelayMs;
        queueCount++;
      }
      if (typeof j.coldStartMs === 'number' && j.coldStartMs > 0) {
        coldSum += j.coldStartMs;
        coldCount++;
      }

      const mEntry = modMap.get(j.modality) ?? {
        jobCount: 0,
        completedCount: 0,
        costUsd: 0,
        execSum: 0,
        execCount: 0,
      };
      mEntry.jobCount++;
      if (j.status === JobStatus.COMPLETED) mEntry.completedCount++;
      mEntry.costUsd += cost;
      if (typeof j.executionMs === 'number' && j.executionMs > 0) {
        mEntry.execSum += j.executionMs;
        mEntry.execCount++;
      }
      modMap.set(j.modality, mEntry);

      const pEntry = provStats.get(j.providerConfigId) ?? {
        jobCount: 0,
        completedCount: 0,
        costUsd: 0,
        execSum: 0,
        execCount: 0,
      };
      pEntry.jobCount++;
      if (j.status === JobStatus.COMPLETED) pEntry.completedCount++;
      pEntry.costUsd += cost;
      if (typeof j.executionMs === 'number' && j.executionMs > 0) {
        pEntry.execSum += j.executionMs;
        pEntry.execCount++;
      }
      provStats.set(j.providerConfigId, pEntry);

      const dayKey = j.createdAt.toISOString().slice(0, 10);
      const dEntry = dailyMap.get(dayKey) ?? { jobCount: 0, costUsd: 0 };
      dEntry.jobCount++;
      dEntry.costUsd += cost;
      dailyMap.set(dayKey, dEntry);
    }

    const byModality = [...modMap.entries()].map(([modality, st]) => ({
      modality,
      jobCount: st.jobCount,
      completedCount: st.completedCount,
      costUsd: Number(st.costUsd.toFixed(6)),
      avgExecutionMs: st.execCount > 0 ? Math.round(st.execSum / st.execCount) : 0,
    }));

    const byProvider = [...provStats.entries()].map(([providerConfigId, st]) => {
      const prov = providerMap.get(providerConfigId);
      const settingsObj =
        typeof prov?.settings === 'object' && prov.settings !== null
          ? (prov.settings as Record<string, unknown>)
          : {};
      const monthlyBudgetUsd =
        typeof settingsObj['monthlyBudgetUsd'] === 'number'
          ? settingsObj['monthlyBudgetUsd']
          : null;
      return {
        providerConfigId,
        providerName: prov?.name ?? providerConfigId,
        jobCount: st.jobCount,
        successRate:
          st.jobCount > 0
            ? Number(((st.completedCount / st.jobCount) * 100).toFixed(1))
            : 100,
        costUsd: Number(st.costUsd.toFixed(6)),
        avgExecutionMs: st.execCount > 0 ? Math.round(st.execSum / st.execCount) : 0,
        monthlyBudgetUsd,
      };
    });

    const dailySeries = [...dailyMap.entries()].map(([date, st]) => ({
      date,
      jobCount: st.jobCount,
      costUsd: Number(st.costUsd.toFixed(6)),
    }));

    return {
      totalJobs: jobs.length,
      completedJobs,
      failedJobs,
      totalCostUsd: Number(totalCostUsd.toFixed(6)),
      avgExecutionMs: execCount > 0 ? Math.round(execSum / execCount) : 0,
      avgQueueDelayMs: queueCount > 0 ? Math.round(queueSum / queueCount) : 0,
      avgColdStartMs: coldCount > 0 ? Math.round(coldSum / coldCount) : 0,
      byModality,
      byProvider,
      dailySeries,
    };
  }

  /**
   * 6.1 Cross-Modality Pipeline Recipe Engine: topologically sorts multi-step generation DAGs,
   * interpolates upstream step outputs ({{steps.stepId.key}}) into downstream prompts and params,
   * and dispatches each step in dependency order.
   */
  async runPipeline(dto: RunPipelineDto): Promise<{
    pipelineRunId: string;
    name: string;
    stepResults: Array<{
      stepId: string;
      job: JobModel;
      resolvedPrompt: string;
    }>;
  }> {
    const pipelineRunId = `pipe_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

    // Topological sort with cycle detection
    const stepById = new Map(dto.steps.map((s) => [s.stepId, s]));
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const orderedSteps: typeof dto.steps = [];

    const visit = (stepId: string): void => {
      if (visited.has(stepId)) return;
      if (visiting.has(stepId)) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          400,
          `Pipeline recipe contains a dependency cycle involving step "${stepId}"`,
        );
      }
      const step = stepById.get(stepId);
      if (!step) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          400,
          `Pipeline step references unknown dependency "${stepId}"`,
        );
      }
      visiting.add(stepId);
      for (const dep of step.dependsOn) {
        visit(dep);
      }
      visiting.delete(stepId);
      visited.add(stepId);
      orderedSteps.push(step);
    };

    for (const s of dto.steps) {
      visit(s.stepId);
    }

    const stepOutputs = new Map<string, Record<string, string>>();
    const stepResults: Array<{
      stepId: string;
      job: JobModel;
      resolvedPrompt: string;
    }> = [];

    const interpolateSteps = (input: string): string =>
      input.replace(
        /\{\{\s*steps\.([a-zA-Z0-9_-]+)\.([a-zA-Z0-9_-]+)\s*\}\}/g,
        (_m, sid: string, field: string) =>
          stepOutputs.get(sid)?.[field] ?? `{{steps.${sid}.${field}}}`,
      );

    for (const step of orderedSteps) {
      const resolvedPrompt = interpolateSteps(step.rawPrompt);
      const clonedParams = JSON.parse(
        interpolateSteps(JSON.stringify(step.params)),
      ) as ModalityParams;

      const job = await this.create({
        projectId: dto.projectId,
        executionMode: 'AUTO_FIRE',
        rawPrompt: resolvedPrompt,
        pinnedFileIds: [],
        params: clonedParams,
        advanced: {
          __pipelineRunId: pipelineRunId,
          __pipelineStepId: step.stepId,
        },
        providerConfigId: step.providerConfigId,
        providerModel: step.providerModel ?? null,
        middlemanProfileId: null,
        skipMiddleman: dto.skipMiddleman ?? false,
        parentAssetId: null,
      });

      stepOutputs.set(step.stepId, {
        jobId: job.id,
        rawPrompt: resolvedPrompt,
        enhancedPrompt: resolvedPrompt,
        ...(step.outputs ?? {}),
      });
      stepResults.push({ stepId: step.stepId, job, resolvedPrompt });
    }

    return {
      pipelineRunId,
      name: dto.name,
      stepResults,
    };
  }

  /**
   * 6.2 Data-Driven Batch Matrix Runner: expands CSV/JSON rows or cartesian variable arrays
   * into interpolated prompts and dispatches all jobs under a shared batchMatrixId.
   */
  async createBatchMatrix(dto: BatchMatrixJobDto): Promise<{
    batchMatrixId: string;
    count: number;
    jobs: JobModel[];
  }> {
    let rows: Array<Record<string, string | number>> = [];
    if (dto.rows && dto.rows.length > 0) {
      rows = dto.rows.slice(0, 32);
    } else if (dto.variables && Object.keys(dto.variables).length > 0) {
      const entries = Object.entries(dto.variables);
      let acc: Array<Record<string, string>> = [{}];
      for (const [key, vals] of entries) {
        const next: Array<Record<string, string>> = [];
        for (const prefix of acc) {
          for (const val of vals) {
            if (next.length < 32) {
              next.push({ ...prefix, [key]: val });
            }
          }
        }
        acc = next;
      }
      rows = acc;
    }

    if (rows.length === 0) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Batch matrix requires either non-empty rows or variables',
      );
    }

    const batchMatrixId = `mtx_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const jobs: JobModel[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      const interpolatedPrompt = dto.promptTemplate.replace(
        /\{\{\s*([a-zA-Z0-9_-]+)\s*\}\}/g,
        (_m, col: string) =>
          row[col] !== undefined ? String(row[col]) : `{{${col}}}`,
      );

      const job = await this.create({
        projectId: dto.projectId,
        executionMode: dto.executionMode,
        rawPrompt: interpolatedPrompt,
        pinnedFileIds: [],
        params: dto.params,
        advanced: {
          __batchMatrixId: batchMatrixId,
          __matrixRowIndex: i,
        },
        providerConfigId: dto.providerConfigId,
        providerModel: dto.providerModel ?? null,
        middlemanProfileId: null,
        skipMiddleman: dto.skipMiddleman ?? false,
        parentAssetId: null,
      });
      jobs.push(job);
    }

    return { batchMatrixId, count: jobs.length, jobs };
  }

  /**
   * 6.3 Multi-Speaker Dialogue Scene Sequencer: synthesizes a multi-character dialogue script,
   * stitches the master scene WAV with configurable pauses, and stores both the master VOICES
   * asset and per-turn STEM files.
   */
  async createDialogueScene(dto: CreateDialogueSceneDto): Promise<AssetModel> {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });
    if (!project) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Project not found: ${dto.projectId}`,
      );
    }

    const turns =
      dto.turns && dto.turns.length > 0
        ? dto.turns.map((t) => ({
            ...t,
            pauseAfterMs: t.pauseAfterMs ?? dto.pauseBetweenTurnsMs,
          }))
        : dto.scriptText
          ? parseDialogueScript(dto.scriptText, dto.pauseBetweenTurnsMs)
          : [];

    if (turns.length === 0) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Dialogue scene requires either structured turns[] or valid "Speaker: Line" scriptText',
      );
    }

    const scene = synthesizeDialogueScene({
      turns,
      seed: dto.seed ?? 1001,
      defaultPauseMs: dto.pauseBetweenTurnsMs,
    });

    const assetId = `ast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const assetGroupId = `grp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const masterKey = StorageKeys.assetFile(
      project.slug,
      Modality.VOICES,
      assetId,
      1,
      'dialogue_scene.wav',
    );
    await this.storage.putBuffer(masterKey, scene.masterWav, 'audio/wav');

    const fileCreates: Array<{
      role: AssetFileRole;
      storageKey: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      width: number | null;
      height: number | null;
      durationMs: number | null;
      format: string;
      sortIndex: number;
    }> = [
      {
        role: AssetFileRole.PRIMARY,
        storageKey: masterKey,
        fileName: 'dialogue_scene.wav',
        mimeType: 'audio/wav',
        sizeBytes: scene.masterWav.length,
        width: null,
        height: null,
        durationMs: scene.durationMs,
        format: 'wav',
        sortIndex: 0,
      },
    ];

    for (let i = 0; i < scene.turnStems.length; i++) {
      const st = scene.turnStems[i]!;
      const stemKey = StorageKeys.assetFile(
        project.slug,
        Modality.VOICES,
        assetId,
        1,
        st.fileName,
      );
      await this.storage.putBuffer(stemKey, st.wav, 'audio/wav');
      fileCreates.push({
        role: AssetFileRole.STEM,
        storageKey: stemKey,
        fileName: st.fileName,
        mimeType: 'audio/wav',
        sizeBytes: st.wav.length,
        width: null,
        height: null,
        durationMs: st.endMs - st.startMs,
        format: 'wav',
        sortIndex: i + 1,
      });
    }

    const transcriptText = turns
      .map((t) => `${t.speaker}: ${t.text}`)
      .join('\n');

    const created = await this.prisma.generatedAsset.create({
      data: {
        id: assetId,
        projectId: project.id,
        jobId: null,
        modality: Modality.VOICES,
        subMode: GenerationSubMode.STANDARD,
        title: dto.title,
        assetGroupId,
        version: 1,
        batchIndex: 0,
        parentAssetId: null,
        rawPrompt: transcriptText,
        enhancedPrompt: transcriptText,
        negativePrompt: '',
        providerConfigId: null,
        providerKind: ProviderKind.DEMO,
        providerModel: 'dialogue-sequencer-v1',
        tier: ExecutionTier.FREE,
        seed: dto.seed ?? 1001,
        costUsd: 0,
        executionMs: 50,
        approval: ApprovalStatus.DRAFT,
        isFavorite: false,
        tags: ['dialogue-scene', 'multi-speaker'],
        notes: `${turns.length} speaker turns`,
        metadata: {
          modality: 'VOICES',
          durationMs: scene.durationMs,
          voiceProfileId: null,
          transcript: transcriptText,
          alignment: scene.alignment,
          sampleRate: scene.sampleRate,
        } as unknown as Prisma.InputJsonValue,
        files: {
          create: fileCreates,
        },
      },
      include: {
        files: true,
        savedToVault: { select: { id: true } },
      },
    });

    return toAssetModel(created);
  }

  private async findOrThrow(id: string): Promise<GenerationJobWithRelations> {
    const row = await this.prisma.generationJob.findUnique({
      where: { id },
      include: JOB_RELATIONS_INCLUDE,
    });
    if (!row) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Generation job not found: ${id}`,
      );
    }
    return row;
  }
}
