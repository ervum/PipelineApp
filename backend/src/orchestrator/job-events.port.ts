import {
  JobCompletedEvent,
  JobCreatedEvent,
  JobFailedEvent,
  JobProgressEvent,
  JobStatusEvent,
  McpInvocationEvent,
  MiddlemanChunkEvent,
  MiddlemanCompleteEvent,
  MiddlemanErrorEvent,
  ProviderHealthEvent,
  VaultFileUpdatedEvent,
  WorkerStatusEvent,
} from '@forge/shared';
import { Injectable, Logger } from '@nestjs/common';

export const JOB_EVENTS_PUBLISHER = Symbol('JOB_EVENTS_PUBLISHER');

export interface JobEventsPublisherPort {
  jobCreated(event: JobCreatedEvent): void;
  jobStatus(event: JobStatusEvent): void;
  middlemanChunk(event: MiddlemanChunkEvent): void;
  middlemanComplete(event: MiddlemanCompleteEvent): void;
  middlemanError(event: MiddlemanErrorEvent): void;
  workerStatus(event: WorkerStatusEvent): void;
  progress(event: JobProgressEvent): void;
  completed(event: JobCompletedEvent): void;
  failed(event: JobFailedEvent): void;
  vaultFileUpdated(event: VaultFileUpdatedEvent): void;
  providerHealth(event: ProviderHealthEvent): void;
  mcpInvocation?(event: McpInvocationEvent): void;
}

@Injectable()
export class LoggingJobEventsPublisher implements JobEventsPublisherPort {
  private readonly logger = new Logger(LoggingJobEventsPublisher.name);

  jobCreated(event: JobCreatedEvent): void {
    this.logger.debug(`[job:created] job=${event.job.id} project=${event.job.projectId}`);
  }

  jobStatus(event: JobStatusEvent): void {
    this.logger.debug(
      `[job:status] job=${event.jobId} ${event.from} -> ${event.to}: ${event.message}`,
    );
  }

  middlemanChunk(event: MiddlemanChunkEvent): void {
    this.logger.verbose(
      `[job:middleman-chunk] job=${event.jobId} seq=${event.seq} chars=${event.accumulatedChars}`,
    );
  }

  middlemanComplete(event: MiddlemanCompleteEvent): void {
    this.logger.debug(
      `[job:middleman-complete] job=${event.jobId} nextStatus=${event.nextStatus}`,
    );
  }

  middlemanError(event: MiddlemanErrorEvent): void {
    this.logger.warn(
      `[job:middleman-error] job=${event.jobId} code=${event.code}: ${event.message}`,
    );
  }

  workerStatus(event: WorkerStatusEvent): void {
    this.logger.debug(
      `[job:worker-status] job=${event.jobId} phase=${event.phase} coldStart=${event.coldStart}`,
    );
  }

  progress(event: JobProgressEvent): void {
    this.logger.verbose(
      `[job:progress] job=${event.jobId} ${event.percent}% (${event.stage})`,
    );
  }

  completed(event: JobCompletedEvent): void {
    this.logger.debug(
      `[job:completed] job=${event.jobId} assets=${event.assets.length}`,
    );
  }

  failed(event: JobFailedEvent): void {
    this.logger.warn(
      `[job:failed] job=${event.jobId} code=${event.code}: ${event.message}`,
    );
  }

  vaultFileUpdated(event: VaultFileUpdatedEvent): void {
    this.logger.debug(
      `[vault:file-updated] project=${event.projectId} file=${event.file.id} (${event.file.name})`,
    );
  }

  providerHealth(event: ProviderHealthEvent): void {
    this.logger.debug(
      `[provider:health] provider=${event.providerConfigId} state=${event.state} latency=${event.latencyMs ?? 'n/a'}ms`,
    );
  }

  mcpInvocation(event: McpInvocationEvent): void {
    this.logger.debug(
      `[mcp:invocation] tool=${event.entry.toolName} transport=${event.entry.transport} duration=${event.entry.durationMs}ms`,
    );
  }
}
