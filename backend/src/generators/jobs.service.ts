import {
  CreateJobDto,
  ErrorCode,
  ExecutionMode,
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
  SEED_MAX,
  TERMINAL_JOB_STATUSES,
  UpdateCompiledDto,
} from '@forge/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../common/errors/domain.error';
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
import { StorageService } from '../storage/storage.service';
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
