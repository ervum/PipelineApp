import {
  CompiledPrompt,
  ErrorCode,
  ExecutionMode,
  GenerationSubMode,
  JobStatus,
  Modality,
  ModalityParams,
  ModalityParamsSchema,
  SEED_MAX,
  TERMINAL_JOB_STATUSES,
} from '@forge/shared';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { GenerationJob, Prisma } from '@prisma/client';
import { createHmac } from 'node:crypto';
import { AppConfigService } from '../config/app-config.service';
import { DomainError } from '../common/errors/domain.error';
import { mimeFromFilename } from '../common/utils/mime';
import { MiddlemanCompilerService } from '../middleman/middleman-compiler.service';
import { MiddlemanTemplatesService } from '../middleman/middleman-templates.service';
import {
  JOB_EVENTS_PUBLISHER,
  JobEventsPublisherPort,
} from '../orchestrator/job-events.port';
import { PrismaService } from '../prisma/prisma.service';
import { GoogleWebBrowserService } from '../providers/google-web/google-web-browser.service';
import {
  ProviderRuntimeConfig,
  ProvidersService,
} from '../providers/providers.service';
import { StorageService } from '../storage/storage.service';
import { RunPodStatusResponse } from './adapters/runpod/runpod-client';
import { RunPodServerlessAdapter } from './adapters/runpod/runpod-serverless.adapter';
import {
  GeneratorDispatchContext,
  GeneratorPollResult,
  GeneratorReferenceFile,
} from './generator-adapter.interface';
import { GeneratorAdapterRegistry } from './generator-adapter.registry';
import { JobStateService } from './job-state.service';
import { OutputIngestionService } from './output-ingestion.service';

const JOB_MAX_CONCURRENT_GLOBAL = 8;
const JOB_WORKER_TICK_MS = 400;

function titleCasePrompt(raw: string): string {
  const words = raw
    .replace(/[^\w\s-]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .slice(0, 4);
  if (words.length === 0) return 'Generated Asset';
  return words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

@Injectable()
export class JobProcessorService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(JobProcessorService.name);
  private readonly inflight = new Map<string, AbortController>();
  private readonly inflightPolls = new Set<string>();
  private ticking = false;
  private timer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly appConfig: AppConfigService,
    private readonly providersService: ProvidersService,
    private readonly templatesService: MiddlemanTemplatesService,
    private readonly compilerService: MiddlemanCompilerService,
    private readonly adapterRegistry: GeneratorAdapterRegistry,
    private readonly runpodAdapter: RunPodServerlessAdapter,
    private readonly jobState: JobStateService,
    private readonly ingestionService: OutputIngestionService,
    private readonly storage: StorageService,
    private readonly googleWebBrowser: GoogleWebBrowserService,
    @Inject(JOB_EVENTS_PUBLISHER)
    private readonly eventsPublisher: JobEventsPublisherPort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.shuttingDown = false;
    try {
      await this.recover();
    } catch (err) {
      this.logger.error(
        `Boot recovery error: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.timer = setInterval(() => {
      void this.tick();
    }, JOB_WORKER_TICK_MS);
    this.timer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const [, controller] of this.inflight) {
      controller.abort();
    }
    this.inflight.clear();
  }

  cancelInflight(jobId: string): void {
    const ctrl = this.inflight.get(jobId);
    if (ctrl) {
      ctrl.abort();
      this.inflight.delete(jobId);
    }
  }

  signWebhookToken(jobId: string): string {
    return createHmac('sha256', this.appConfig.webhookSigningSecret)
      .update(jobId)
      .digest('hex');
  }

  async recover(): Promise<void> {
    // 1. COMPILING jobs without a live controller -> back to QUEUED (compiled payload discarded)
    const compilingJobs = await this.prisma.generationJob.findMany({
      where: { status: JobStatus.COMPILING },
      select: { id: true },
    });
    for (const j of compilingJobs) {
      if (!this.inflight.has(j.id)) {
        await this.prisma.generationJob.update({
          where: { id: j.id },
          data: {
            status: JobStatus.QUEUED,
            compiledPayload: Prisma.DbNull,
          },
        });
      }
    }

    // 2. DISPATCHING older than 60s -> FAILED PROVIDER_ERROR 'Interrupted by server restart'
    const cutoff60s = new Date(Date.now() - 60_000);
    const staleDispatching = await this.prisma.generationJob.findMany({
      where: {
        status: JobStatus.DISPATCHING,
        updatedAt: { lt: cutoff60s },
      },
      select: { id: true },
    });
    for (const j of staleDispatching) {
      try {
        await this.jobState.transition(
          j.id,
          JobStatus.FAILED,
          {
            errorCode: ErrorCode.PROVIDER_ERROR,
            errorMessage: 'Interrupted by server restart',
          },
          'Interrupted by server restart',
          { retryable: true },
        );
      } catch {
        // Ignore if status changed concurrently
      }
    }

    // 3. COLD_START | RUNNING -> nextPollAt = now()
    await this.prisma.generationJob.updateMany({
      where: {
        status: { in: [JobStatus.COLD_START, JobStatus.RUNNING] },
      },
      data: {
        nextPollAt: new Date(),
      },
    });

    // 4. INGESTING -> re-run poll once to re-fetch outputs if remoteHandle exists
    const ingestingJobs = await this.prisma.generationJob.findMany({
      where: { status: JobStatus.INGESTING },
      select: { id: true, remoteHandle: true },
    });
    for (const j of ingestingJobs) {
      if (j.remoteHandle !== null) {
        await this.prisma.generationJob.update({
          where: { id: j.id },
          data: {
            status: JobStatus.RUNNING,
            nextPollAt: new Date(),
          },
        });
      }
    }
  }

  async tick(): Promise<void> {
    if (this.ticking || this.shuttingDown) {
      return;
    }
    this.ticking = true;
    try {
      await this.claimSkippedOrCachedQueuedJobs();
      await this.claimCompileWork();
      await this.claimDispatchWork();
      await this.claimPollWork();
      await this.checkTimeouts();
    } catch (err) {
      this.logger.error(
        `Worker tick error: ${err instanceof Error ? err.message : String(err)}`,
      );
    } finally {
      this.ticking = false;
    }
  }

  private async claimSkippedOrCachedQueuedJobs(): Promise<void> {
    const free = JOB_MAX_CONCURRENT_GLOBAL - this.inflight.size;
    if (free <= 0) return;

    const claimed = await this.prisma.$queryRaw<
      Array<{ id: string; executionMode: string }>
    >`
      UPDATE "generation_jobs"
      SET "status" = CASE
        WHEN "executionMode" = 'INTERCEPT' AND "skipMiddleman" = false THEN 'AWAITING_REVIEW'::"JobStatus"
        ELSE 'READY'::"JobStatus"
      END,
      "updatedAt" = now()
      WHERE "id" IN (
        SELECT "id" FROM "generation_jobs"
        WHERE "status" = 'QUEUED' AND ("skipMiddleman" = true OR "compiledPayload" IS NOT NULL)
        ORDER BY "createdAt" ASC
        LIMIT ${free}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "executionMode";
    `;

    for (const row of claimed) {
      const target =
        row.executionMode === ExecutionMode.INTERCEPT
          ? JobStatus.AWAITING_REVIEW
          : JobStatus.READY;
      await this.jobState.recordExternalTransition(
        row.id,
        JobStatus.QUEUED,
        target,
        'Ready for dispatch (Middleman skipped or cached)',
      );
    }
  }

  private async claimCompileWork(): Promise<void> {
    const free = JOB_MAX_CONCURRENT_GLOBAL - this.inflight.size;
    if (free <= 0) return;

    const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "generation_jobs" SET "status" = 'COMPILING', "updatedAt" = now()
      WHERE "id" IN (
        SELECT "id" FROM "generation_jobs"
        WHERE "status" = 'QUEUED' AND "skipMiddleman" = false AND "compiledPayload" IS NULL
        ORDER BY "createdAt" ASC LIMIT ${free} FOR UPDATE SKIP LOCKED)
      RETURNING "id";
    `;

    for (const row of claimed) {
      await this.jobState.recordExternalTransition(
        row.id,
        JobStatus.QUEUED,
        JobStatus.COMPILING,
        'Claimed for Middleman compilation',
      );
      void this.runCompile(row.id);
    }

    // Also pick up COMPILING jobs triggered via recompile that have no active inflight controller
    const remainingFree = JOB_MAX_CONCURRENT_GLOBAL - this.inflight.size;
    if (remainingFree > 0) {
      const orphanCompiling = await this.prisma.generationJob.findMany({
        where: { status: JobStatus.COMPILING },
        orderBy: { updatedAt: 'asc' },
        take: remainingFree,
        select: { id: true },
      });
      for (const row of orphanCompiling) {
        if (!this.inflight.has(row.id)) {
          void this.runCompile(row.id);
        }
      }
    }
  }

  private async claimDispatchWork(): Promise<void> {
    let free = JOB_MAX_CONCURRENT_GLOBAL - this.inflight.size;
    if (free <= 0) return;

    const readyCandidates = await this.prisma.generationJob.findMany({
      where: { status: JobStatus.READY },
      orderBy: { createdAt: 'asc' },
      take: free * 2,
      select: { id: true, providerConfigId: true },
    });

    if (readyCandidates.length === 0) return;

    const activeCountsRaw = await this.prisma.generationJob.groupBy({
      by: ['providerConfigId'],
      where: {
        status: {
          in: [
            JobStatus.DISPATCHING,
            JobStatus.COLD_START,
            JobStatus.RUNNING,
            JobStatus.INGESTING,
          ],
        },
      },
      _count: { _all: true },
    });

    const activeByProvider = new Map<string, number>();
    for (const entry of activeCountsRaw) {
      activeByProvider.set(entry.providerConfigId, entry._count._all);
    }

    const providerCache = new Map<string, ProviderRuntimeConfig>();

    for (const candidate of readyCandidates) {
      if (free <= 0) break;

      let runtime = providerCache.get(candidate.providerConfigId);
      if (!runtime) {
        try {
          runtime = await this.providersService.getRuntimeConfig(
            candidate.providerConfigId,
          );
          providerCache.set(candidate.providerConfigId, runtime);
        } catch {
          continue;
        }
      }

      const currentActive =
        activeByProvider.get(candidate.providerConfigId) ?? 0;
      const maxConcurrency = runtime.settings.maxConcurrency ?? 2;
      if (currentActive >= maxConcurrency) {
        continue;
      }

      const claimed = await this.prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE "generation_jobs" SET "status" = 'DISPATCHING', "updatedAt" = now()
        WHERE "id" IN (
          SELECT "id" FROM "generation_jobs"
          WHERE "id" = ${candidate.id} AND "status" = 'READY'
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id";
      `;

      if (claimed.length > 0) {
        activeByProvider.set(candidate.providerConfigId, currentActive + 1);
        free -= 1;
        await this.jobState.recordExternalTransition(
          candidate.id,
          JobStatus.READY,
          JobStatus.DISPATCHING,
          `Dispatching to ${runtime.name}`,
        );
        void this.runDispatch(candidate.id);
      }
    }
  }

  private async claimPollWork(): Promise<void> {
    const candidates = await this.prisma.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "generation_jobs"
      WHERE "status" IN ('COLD_START', 'RUNNING')
        AND "nextPollAt" <= now()
      ORDER BY "nextPollAt" ASC
      LIMIT 20
      FOR UPDATE SKIP LOCKED
    `;

    for (const row of candidates) {
      if (this.inflightPolls.has(row.id) || this.inflight.has(row.id)) {
        continue;
      }
      void this.runPoll(row.id);
    }
  }

  private async checkTimeouts(): Promise<void> {
    const activeJobs = await this.prisma.generationJob.findMany({
      where: {
        status: {
          in: [JobStatus.DISPATCHING, JobStatus.COLD_START, JobStatus.RUNNING],
        },
        dispatchedAt: { not: null },
      },
      include: {
        project: true,
      },
    });

    const nowMs = Date.now();
    for (const job of activeJobs) {
      if (!job.dispatchedAt) continue;
      let provider: ProviderRuntimeConfig;
      try {
        provider = await this.providersService.getRuntimeConfig(
          job.providerConfigId,
        );
      } catch {
        continue;
      }

      const elapsedMs = nowMs - job.dispatchedAt.getTime();
      if (elapsedMs <= provider.settings.timeoutMs) {
        continue;
      }

      this.cancelInflight(job.id);

      // Best-effort remote cancel
      try {
        const adapter = this.adapterRegistry.resolve(
          provider.kind,
          job.modality as Modality,
          job.subMode as GenerationSubMode,
        );
        if (adapter.cancel && job.remoteHandle) {
          const dummyCtx = await this.buildDispatchContext(
            job,
            provider,
            new AbortController().signal,
          );
          await adapter.cancel(
            dummyCtx,
            job.remoteHandle as Record<string, unknown>,
          );
        }
      } catch {
        // Ignore remote cancel errors on timeout
      }

      try {
        await this.jobState.transition(
          job.id,
          JobStatus.FAILED,
          {
            errorCode: ErrorCode.PROVIDER_TIMEOUT,
            errorMessage: `Provider timed out after ${provider.settings.timeoutMs}ms`,
          },
          `Provider timed out after ${provider.settings.timeoutMs}ms`,
          { retryable: true },
        );
      } catch {
        // Ignore if already transitioned
      }
    }
  }

  private async runCompile(jobId: string): Promise<void> {
    if (this.inflight.has(jobId)) return;
    const controller = new AbortController();
    this.inflight.set(jobId, controller);

    try {
      await this.compilerService.compileForJob(jobId, controller.signal);
    } catch {
      // MiddlemanCompilerService handles transition to FAILED and emits events
    } finally {
      this.inflight.delete(jobId);
    }
  }

  private async runDispatch(jobId: string): Promise<void> {
    if (this.inflight.has(jobId)) return;
    const controller = new AbortController();
    this.inflight.set(jobId, controller);
    let dispatchedProvider: ProviderRuntimeConfig | null = null;

    try {
      const job = await this.prisma.generationJob.findUnique({
        where: { id: jobId },
        include: { project: true },
      });
      if (!job || job.status !== JobStatus.DISPATCHING) {
        return;
      }

      const provider = await this.providersService.getRuntimeConfig(
        job.providerConfigId,
      );
      dispatchedProvider = provider;
      const adapter = this.adapterRegistry.resolve(
        provider.kind,
        job.modality as Modality,
        job.subMode as GenerationSubMode,
      );

      const ctx = await this.buildDispatchContext(
        job,
        provider,
        controller.signal,
      );

      const dispatchedAt = new Date();
      const updatedJob = await this.prisma.generationJob.update({
        where: { id: job.id },
        data: {
          dispatchedAt,
          seed: ctx.seed,
        },
        include: { project: true },
      });
      ctx.job = updatedJob;

      const submitRes = await adapter.submit(ctx);

      if (controller.signal.aborted) {
        return;
      }

      if (submitRes.mode === 'sync') {
        const ingestingJob = await this.jobState.transition(
          job.id,
          JobStatus.INGESTING,
          {
            startedAt: dispatchedAt,
            progressPercent: 95,
            progressStage: 'ingesting',
            ...(submitRes.executionMs !== undefined
              ? { executionMs: submitRes.executionMs }
              : {}),
          },
          'Ingesting generated outputs',
        );

        await this.ingestionService.ingest({
          job: ingestingJob,
          project: job.project,
          provider,
          params: ctx.params,
          compiled: ctx.compiled,
          outputs: submitRes.outputs,
          supportsNativeTransparency: Boolean(
            adapter.supportsNativeTransparency,
          ),
          reportedCostUsd: submitRes.costUsd,
          executionMs: submitRes.executionMs,
        });
      } else {
        const nextPollAt = new Date(Date.now() + submitRes.pollAfterMs);
        await this.jobState.transition(
          job.id,
          submitRes.initialStatus === 'COLD_START'
            ? JobStatus.COLD_START
            : JobStatus.RUNNING,
          {
            externalJobId: submitRes.externalJobId,
            externalStatus: submitRes.initialStatus,
            remoteHandle:
              submitRes.handle as unknown as Prisma.InputJsonValue,
            nextPollAt,
          },
          submitRes.initialStatus === 'COLD_START'
            ? 'Waiting on serverless worker cold start'
            : 'Generator job running remotely',
        );
      }
    } catch (err) {
      if (controller.signal.aborted) {
        return;
      }
      const domainErr =
        err instanceof DomainError
          ? err
          : new DomainError(
              ErrorCode.PROVIDER_ERROR,
              502,
              err instanceof Error ? err.message : String(err),
            );
      try {
        await this.jobState.transition(
          jobId,
          JobStatus.FAILED,
          {
            errorCode: domainErr.code,
            errorMessage: domainErr.message,
          },
          domainErr.message,
          { retryable: true },
        );
      } catch {
        // Ignore if job was already cancelled
      }
    } finally {
      this.inflight.delete(jobId);
      if (dispatchedProvider?.settings?.autoDeleteCreatedChats) {
        void this.googleWebBrowser
          .deleteWebChatsForJob(jobId)
          .catch((err) =>
            this.logger.warn(
              `Auto-delete web chats for job ${jobId} failed: ${String(err)}`,
            ),
          );
      }
    }
  }

  private async runPoll(jobId: string): Promise<void> {
    if (this.inflightPolls.has(jobId)) return;
    this.inflightPolls.add(jobId);
    const controller = new AbortController();
    this.inflight.set(jobId, controller);

    try {
      const job = await this.prisma.generationJob.findUnique({
        where: { id: jobId },
        include: { project: true },
      });
      if (
        !job ||
        (job.status !== JobStatus.COLD_START &&
          job.status !== JobStatus.RUNNING)
      ) {
        return;
      }

      const provider = await this.providersService.getRuntimeConfig(
        job.providerConfigId,
      );
      const adapter = this.adapterRegistry.resolve(
        provider.kind,
        job.modality as Modality,
        job.subMode as GenerationSubMode,
      );
      if (!adapter.poll) {
        return;
      }

      const updatedJob = await this.prisma.generationJob.update({
        where: { id: job.id },
        data: { pollCount: { increment: 1 } },
        include: { project: true },
      });

      const ctx = await this.buildDispatchContext(
        updatedJob,
        provider,
        controller.signal,
      );
      const handle =
        typeof updatedJob.remoteHandle === 'object' &&
        updatedJob.remoteHandle !== null
          ? { ...(updatedJob.remoteHandle as Record<string, unknown>) }
          : {};

      const pollRes = await adapter.poll(ctx, handle);
      await this.applyPollResult(
        updatedJob,
        provider,
        ctx,
        handle,
        pollRes,
        Boolean(adapter.supportsNativeTransparency),
      );
    } catch (err) {
      if (controller.signal.aborted) return;
      const domainErr =
        err instanceof DomainError
          ? err
          : new DomainError(
              ErrorCode.PROVIDER_ERROR,
              502,
              err instanceof Error ? err.message : String(err),
            );
      try {
        await this.jobState.transition(
          jobId,
          JobStatus.FAILED,
          {
            errorCode: domainErr.code,
            errorMessage: domainErr.message,
          },
          domainErr.message,
          { retryable: true },
        );
      } catch {
        // Ignore if concurrently transitioned
      }
    } finally {
      this.inflightPolls.delete(jobId);
      this.inflight.delete(jobId);
    }
  }

  async handleRemoteResult(
    jobId: string,
    body: RunPodStatusResponse,
  ): Promise<void> {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: { project: true },
    });
    if (!job) {
      return;
    }
    const status = job.status as JobStatus;
    if (
      TERMINAL_JOB_STATUSES.includes(status) ||
      status === JobStatus.INGESTING
    ) {
      return;
    }

    const provider = await this.providersService.getRuntimeConfig(
      job.providerConfigId,
    );
    const ctx = await this.buildDispatchContext(
      job,
      provider,
      new AbortController().signal,
    );
    const handle =
      typeof job.remoteHandle === 'object' && job.remoteHandle !== null
        ? { ...(job.remoteHandle as Record<string, unknown>) }
        : {};

    const pollRes = await this.runpodAdapter.evaluateStatusResponse(
      ctx,
      handle,
      body,
    );
    await this.applyPollResult(job, provider, ctx, handle, pollRes, false);
  }

  private async applyPollResult(
    job: GenerationJob & { project: Prisma.ProjectGetPayload<object> },
    provider: ProviderRuntimeConfig,
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
    pollRes: GeneratorPollResult,
    supportsNativeTransparency: boolean,
  ): Promise<void> {
    if (pollRes.state === 'pending') {
      const nextPollMs =
        pollRes.pollAfterMs ?? provider.settings.pollIntervalMs;
      const nextPollAt = new Date(Date.now() + nextPollMs);
      const currentStatus = job.status as JobStatus;

      if (
        currentStatus === JobStatus.COLD_START &&
        pollRes.coldStart === false
      ) {
        await this.jobState.transition(
          job.id,
          JobStatus.RUNNING,
          {
            externalStatus: pollRes.externalStatus,
            progressPercent: pollRes.progress ?? job.progressPercent,
            queueDelayMs: pollRes.queueDelayMs ?? job.queueDelayMs,
            remoteHandle: handle as unknown as Prisma.InputJsonValue,
            nextPollAt,
          },
          'Worker warm; execution started',
        );
      } else {
        await this.prisma.generationJob.update({
          where: { id: job.id },
          data: {
            externalStatus: pollRes.externalStatus,
            progressPercent: pollRes.progress ?? job.progressPercent,
            queueDelayMs: pollRes.queueDelayMs ?? job.queueDelayMs,
            remoteHandle: handle as unknown as Prisma.InputJsonValue,
            nextPollAt,
          },
        });
      }

      if (typeof pollRes.progress === 'number') {
        this.eventsPublisher.progress({
          jobId: job.id,
          projectId: job.projectId,
          percent: pollRes.progress,
          stage: pollRes.coldStart ? 'cold-start' : 'running',
          message: `${pollRes.externalStatus} (${pollRes.progress}%)`,
          etaMs: null,
        });
      }
      return;
    }

    if (pollRes.state === 'failed') {
      await this.jobState.transition(
        job.id,
        JobStatus.FAILED,
        {
          externalStatus: pollRes.externalStatus,
          errorCode: pollRes.code,
          errorMessage: pollRes.message,
        },
        pollRes.message,
        { retryable: pollRes.retryable },
      );
      return;
    }

    // completed
    const warmAtSubmit = Boolean(handle['warmAtSubmit'] ?? false);
    const coldStartMs = warmAtSubmit ? 0 : (pollRes.queueDelayMs ?? null);

    const ingestingJob = await this.jobState.transition(
      job.id,
      JobStatus.INGESTING,
      {
        externalStatus: pollRes.externalStatus,
        progressPercent: 95,
        progressStage: 'ingesting',
        ...(pollRes.executionMs !== undefined
          ? { executionMs: pollRes.executionMs }
          : {}),
        ...(pollRes.queueDelayMs !== undefined
          ? { queueDelayMs: pollRes.queueDelayMs }
          : {}),
        ...(coldStartMs !== null ? { coldStartMs } : {}),
      },
      'Ingesting generated outputs',
    );

    await this.ingestionService.ingest({
      job: ingestingJob,
      project: job.project,
      provider,
      params: ctx.params,
      compiled: ctx.compiled,
      outputs: pollRes.outputs,
      supportsNativeTransparency,
      reportedCostUsd: pollRes.costUsd,
      executionMs: pollRes.executionMs,
      queueDelayMs: pollRes.queueDelayMs,
      coldStartMs,
    });
  }

  private async buildDispatchContext(
    job: GenerationJob & { project: Prisma.ProjectGetPayload<object> },
    provider: ProviderRuntimeConfig,
    signal: AbortSignal,
  ): Promise<GeneratorDispatchContext> {
    const modality = job.modality as Modality;
    const subMode = job.subMode as GenerationSubMode;

    const rawParamsObj =
      typeof job.userParams === 'object' && job.userParams !== null
        ? (job.userParams as Record<string, unknown>)
        : { modality };
    const parsedParams = ModalityParamsSchema.parse({
      modality,
      ...rawParamsObj,
    }) as ModalityParams;

    let compiled: CompiledPrompt;
    if (typeof job.editedPayload === 'object' && job.editedPayload !== null) {
      compiled = job.editedPayload as unknown as CompiledPrompt;
    } else if (
      typeof job.compiledPayload === 'object' &&
      job.compiledPayload !== null
    ) {
      compiled = job.compiledPayload as unknown as CompiledPrompt;
    } else {
      const template = await this.templatesService.resolve(
        job.projectId,
        modality,
      );
      compiled = {
        assetTitle: titleCasePrompt(job.rawPrompt),
        enhancedPrompt: job.rawPrompt,
        negativePrompt: template.defaultNegativePrompt,
        recommendedParams: {},
        contextSourcesUsed: [],
        warnings: ['Middleman bypassed'],
      };
    }

    const descriptor = this.providersService.describeAdapterOrFallback(
      provider,
      modality,
      subMode,
    );

    const paramSpecDefaults: Record<string, unknown> = {};
    for (const spec of descriptor.paramSpecs) {
      paramSpecDefaults[spec.key] = spec.default;
    }

    const userAdvanced =
      typeof rawParamsObj['advanced'] === 'object' &&
      rawParamsObj['advanced'] !== null &&
      !Array.isArray(rawParamsObj['advanced'])
        ? (rawParamsObj['advanced'] as Record<string, unknown>)
        : {};

    const mergedParams: Record<string, unknown> = {
      ...paramSpecDefaults,
      ...compiled.recommendedParams,
      ...userAdvanced,
    };

    const paramSeed =
      'seed' in parsedParams && typeof parsedParams.seed === 'number'
        ? parsedParams.seed
        : null;
    const seed =
      paramSeed ?? job.seed ?? Math.floor(Math.random() * SEED_MAX);

    const references: GeneratorReferenceFile[] = job.referenceStorageKeys.map(
      (storageKey) => {
        const mimeType = mimeFromFilename(storageKey, 'image/png');
        let cachedB64: string | null = null;
        const loadB64 = async (): Promise<string> => {
          if (cachedB64 !== null) return cachedB64;
          const buf = await this.storage.getBuffer(storageKey);
          cachedB64 = buf.toString('base64');
          return cachedB64;
        };
        return {
          storageKey,
          mimeType,
          base64: loadB64,
          dataUri: async () => `data:${mimeType};base64,${await loadB64()}`,
          publicUrl: this.appConfig.publicWebhookBaseUrl
            ? `${this.appConfig.publicWebhookBaseUrl.replace(/\/$/, '')}/api/v1/media/references?key=${encodeURIComponent(storageKey)}`
            : null,
        };
      },
    );

    let voiceProfile = null;
    if (parsedParams.modality === Modality.VOICES && parsedParams.voiceProfileId) {
      voiceProfile = await this.prisma.voiceProfile.findUnique({
        where: { id: parsedParams.voiceProfileId },
      });
    }

    const webhookBase = this.appConfig.publicWebhookBaseUrl;
    const webhookUrl =
      webhookBase && provider.settings.useWebhook
        ? `${webhookBase.replace(/\/$/, '')}/api/v1/webhooks/runpod/${job.id}?token=${this.signWebhookToken(job.id)}`
        : null;

    return {
      job,
      project: job.project,
      provider,
      modality,
      subMode,
      params: parsedParams,
      compiled,
      mergedParams,
      seed,
      references,
      voiceProfile,
      webhookUrl,
      signal,
      reportProgress: (p) => {
        void this.prisma.generationJob
          .updateMany({
            where: {
              id: job.id,
              status: { in: [JobStatus.DISPATCHING, JobStatus.RUNNING] },
            },
            data: {
              status: JobStatus.RUNNING,
              progressPercent: p.percent,
              progressStage: p.stage,
            },
          })
          .catch(() => undefined);
        this.eventsPublisher.progress({
          jobId: job.id,
          projectId: job.projectId,
          percent: p.percent,
          stage: p.stage,
          message: p.message ?? `${p.stage} (${p.percent}%)`,
          etaMs: null,
        });
      },
      reportWorker: (w) => {
        this.eventsPublisher.workerStatus({
          jobId: job.id,
          projectId: job.projectId,
          tier: provider.tier,
          providerKind: provider.kind,
          externalJobId: w.externalJobId,
          externalStatus: w.externalStatus,
          phase: w.phase,
          coldStart: w.coldStart,
          queueDelayMs: w.queueDelayMs,
          workers: w.workers,
          at: new Date().toISOString(),
        });
      },
      log: (message, payload) => {
        void this.prisma.generationJobEvent
          .create({
            data: {
              jobId: job.id,
              type: 'adapter-log',
              message,
              payload: (payload ?? {}) as Prisma.InputJsonValue,
            },
          })
          .catch(() => {
            // Non-fatal
          });
      },
    };
  }
}
