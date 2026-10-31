import {
  canTransition,
  ErrorCode,
  JobStatus,
  TERMINAL_JOB_STATUSES,
} from '@forge/shared';
import { Inject, Injectable } from '@nestjs/common';
import { GenerationJob, Prisma } from '@prisma/client';
import { DomainError } from '../common/errors/domain.error';
import {
  JOB_EVENTS_PUBLISHER,
  JobEventsPublisherPort,
} from '../orchestrator/job-events.port';
import { PrismaService } from '../prisma/prisma.service';

interface LockedJobRow {
  id: string;
  projectId: string;
  status: string;
  startedAt: Date | null;
  errorCode: string | null;
  errorMessage: string | null;
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

    const { updated, from, projectId } = await this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<LockedJobRow[]>`
          SELECT "id", "projectId", "status", "startedAt", "errorCode", "errorMessage"
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

        const isTerminal = TERMINAL_JOB_STATUSES.includes(to);
        const setStartedAt =
          to === JobStatus.RUNNING && row.startedAt === null ? now : undefined;
        const setCompletedAt = isTerminal ? now : undefined;

        const jobRow = await tx.generationJob.update({
          where: { id: jobId },
          data: {
            ...patch,
            status: to,
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
          projectId: row.projectId,
        };
      },
    );

    const effectiveMessage = message || `Transitioned ${from} -> ${to}`;

    this.eventsPublisher.jobStatus({
      jobId,
      projectId,
      from,
      to,
      at: now.toISOString(),
      message: effectiveMessage,
    });

    if (to === JobStatus.FAILED) {
      this.eventsPublisher.failed({
        jobId,
        projectId,
        code: updated.errorCode || ErrorCode.PROVIDER_ERROR,
        message: updated.errorMessage || effectiveMessage,
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
