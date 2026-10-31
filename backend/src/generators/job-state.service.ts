import {
  canTransition,
  ErrorCode,
  JobStatus,
  TERMINAL_JOB_STATUSES,
} from '@forge/shared';
import { Inject, Injectable } from '@nestjs/common';
import { GenerationJob, Prisma } from '@prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { backoffDelayMs } from '../common/utils/backoff';
import {
  JOB_EVENTS_PUBLISHER,
  JobEventsPublisherPort,
} from '../orchestrator/job-events.port';
import { PrismaService } from '../prisma/prisma.service';

const NON_RETRYABLE_ERROR_CODES = new Set<string>([
  ErrorCode.PROVIDER_AUTH_FAILED,
  ErrorCode.VALIDATION_FAILED,
  ErrorCode.MODALITY_UNSUPPORTED,
  ErrorCode.NOT_FOUND,
  ErrorCode.PROVIDER_NOT_CONFIGURED,
  ErrorCode.INVALID_TRANSITION,
  ErrorCode.PAYLOAD_TOO_LARGE,
]);

interface LockedJobRow {
  id: string;
  projectId: string;
  status: string;
  startedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempt?: number;
  maxAttempts?: number;
  compiledPayload?: unknown;
  skipMiddleman?: boolean;
}

@Injectable()
export class JobStateService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(JOB_EVENTS_PUBLISHER)
    private readonly eventsPublisher: JobEventsPublisherPort,
  ) {}

  async transition(
    jobId: string,
    to: JobStatus,
    patch: Prisma.GenerationJobUpdateInput = {},
    message = '',
    opts?: { retryable?: boolean },
  ): Promise<GenerationJob> {
    const now = new Date();

    const { updated, from, effectiveTo, effectiveMsg, projectId } =
      await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<LockedJobRow[]>`
          SELECT "id", "projectId", "status", "startedAt", "errorCode", "errorMessage",
                 "attempt", "maxAttempts", "compiledPayload", "skipMiddleman"
          FROM "generation_jobs"
          WHERE "id" = ${jobId}
          FOR UPDATE
        `;
        const row = rows[0];
        if (!row) {
          throw new DomainError(
            ErrorCode.NOT_FOUND,
            404,
            `Generation job not found: ${jobId}`,
          );
        }

        const currentStatus = row.status as JobStatus;
        if (!canTransition(currentStatus, to)) {
          throw new DomainError(
            ErrorCode.INVALID_TRANSITION,
            409,
            `Invalid job state transition from ${currentStatus} to ${to} for job ${jobId}`,
          );
        }

        const patchErrorCode =
          typeof patch.errorCode === 'string'
            ? patch.errorCode
            : row.errorCode ?? '';
        const canAutoRetry =
          to === JobStatus.FAILED &&
          opts?.retryable === true &&
          !NON_RETRYABLE_ERROR_CODES.has(patchErrorCode) &&
          typeof row.attempt === 'number' &&
          typeof row.maxAttempts === 'number' &&
          row.attempt < row.maxAttempts;

        if (canAutoRetry) {
          const nextAttempt = (row.attempt ?? 1) + 1;
          const maxAttempts = row.maxAttempts ?? 3;
          const delayMs = backoffDelayMs(row.attempt ?? 1);
          const notBefore = new Date(now.getTime() + delayMs);
          const hasCompiled =
            (row.compiledPayload !== null &&
              row.compiledPayload !== undefined) ||
            Boolean(row.skipMiddleman);
          const retryTarget = hasCompiled
            ? JobStatus.READY
            : JobStatus.QUEUED;
          const retryMsg = `Retrying (${nextAttempt}/${maxAttempts}) in ${Math.max(1, Math.round(delayMs / 1000))}s — ${message || patchErrorCode || 'Transient error'}`;

          const jobRow = await tx.generationJob.update({
            where: { id: jobId },
            data: {
              ...patch,
              status: retryTarget,
              attempt: nextAttempt,
              notBefore,
              completedAt: null,
            },
          });

          await tx.generationJobEvent.create({
            data: {
              jobId,
              type: 'retry',
              fromStatus: currentStatus,
              toStatus: retryTarget,
              message: retryMsg,
            },
          });

          return {
            updated: jobRow,
            from: currentStatus,
            effectiveTo: retryTarget,
            effectiveMsg: retryMsg,
            projectId: row.projectId,
          };
        }

        const isTerminal = TERMINAL_JOB_STATUSES.includes(to);
        const setStartedAt =
          to === JobStatus.RUNNING && row.startedAt === null ? now : undefined;
        const setCompletedAt = isTerminal ? now : undefined;

        const jobRow = await tx.generationJob.update({
          where: { id: jobId },
          data: {
            ...patch,
            status: to,
            ...(to === JobStatus.RUNNING || to === JobStatus.COMPLETED
              ? { notBefore: null }
              : {}),
            ...(setStartedAt ? { startedAt: setStartedAt } : {}),
            ...(setCompletedAt ? { completedAt: setCompletedAt } : {}),
          },
        });

        await tx.generationJobEvent.create({
          data: {
            jobId,
            type: 'status',
            fromStatus: currentStatus,
            toStatus: to,
            message: message || `Transitioned ${currentStatus} -> ${to}`,
          },
        });

        return {
          updated: jobRow,
          from: currentStatus,
          effectiveTo: to,
          effectiveMsg: message || `Transitioned ${currentStatus} -> ${to}`,
          projectId: row.projectId,
        };
      });

    this.eventsPublisher.jobStatus({
      jobId,
      projectId,
      from,
      to: effectiveTo,
      at: now.toISOString(),
      message: effectiveMsg,
    });

    if (effectiveTo === JobStatus.FAILED) {
      this.eventsPublisher.failed({
        jobId,
        projectId,
        code: updated.errorCode || ErrorCode.PROVIDER_ERROR,
        message: updated.errorMessage || effectiveMsg,
        retryable: opts?.retryable ?? true,
      });
    }

    return updated;
  }

  async recordExternalTransition(
    jobId: string,
    from: JobStatus,
    to: JobStatus,
    message = '',
  ): Promise<void> {
    const now = new Date();
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      select: { id: true, projectId: true },
    });
    if (!job) {
      return;
    }

    const effectiveMessage = message || `Transitioned ${from} -> ${to}`;

    await this.prisma.generationJobEvent.create({
      data: {
        jobId,
        type: 'status',
        fromStatus: from,
        toStatus: to,
        message: effectiveMessage,
      },
    });

    this.eventsPublisher.jobStatus({
      jobId,
      projectId: job.projectId,
      from,
      to,
      at: now.toISOString(),
      message: effectiveMessage,
    });
  }
}
