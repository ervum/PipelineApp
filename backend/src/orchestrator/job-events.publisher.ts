import {
  ClientToServerEvents,
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
  roomForJob,
  roomForProject,
  ServerToClientEvents,
  VaultFileUpdatedEvent,
  WorkerStatusEvent,
} from '@forge/shared';
import { Injectable, Logger } from '@nestjs/common';
import { Namespace, Server } from 'socket.io';
import { JobEventsPublisherPort } from './job-events.port';

type SocketEmitter =
  | Namespace<ClientToServerEvents, ServerToClientEvents>
  | Server<ClientToServerEvents, ServerToClientEvents>;

const CHUNK_MIN_INTERVAL_MS = 40; // <= 25 chunks/sec per job
const PROGRESS_MIN_INTERVAL_MS = 250; // <= 4 progress events/sec per job

interface BufferedChunkState {
  lastEmitAt: number;
  pending: MiddlemanChunkEvent | null;
  timer: NodeJS.Timeout | null;
}

@Injectable()
export class JobEventsPublisher implements JobEventsPublisherPort {
  private readonly logger = new Logger(JobEventsPublisher.name);
  private server: SocketEmitter | null = null;
  private readonly chunkStates = new Map<string, BufferedChunkState>();
  private readonly lastProgressAt = new Map<string, number>();

  bind(server: SocketEmitter): void {
    this.server = server;
  }

  jobCreated(event: JobCreatedEvent): void {
    this.emitToJobRooms(
      event.job.projectId,
      event.job.id,
      'job:created',
      event,
    );
  }

  jobStatus(event: JobStatusEvent): void {
    this.emitToJobRooms(event.projectId, event.jobId, 'job:status', event);
  }

  middlemanChunk(event: MiddlemanChunkEvent): void {
    const now = Date.now();
    let state = this.chunkStates.get(event.jobId);
    if (!state) {
      state = { lastEmitAt: 0, pending: null, timer: null };
      this.chunkStates.set(event.jobId, state);
    }

    if (state.pending) {
      state.pending = {
        jobId: event.jobId,
        projectId: event.projectId,
        seq: event.seq,
        delta: state.pending.delta + event.delta,
        accumulatedChars: event.accumulatedChars,
      };
    } else {
      state.pending = { ...event };
    }

    const elapsed = now - state.lastEmitAt;
    if (elapsed >= CHUNK_MIN_INTERVAL_MS) {
      this.flushJobChunk(event.jobId);
    } else if (!state.timer) {
      const waitMs = Math.max(1, CHUNK_MIN_INTERVAL_MS - elapsed);
      state.timer = setTimeout(() => {
        this.flushJobChunk(event.jobId);
      }, waitMs);
      state.timer.unref?.();
    }
  }

  middlemanComplete(event: MiddlemanCompleteEvent): void {
    this.flushJobChunk(event.jobId);
    this.clearJobChunkState(event.jobId);
    this.emitToJobRooms(
      event.projectId,
      event.jobId,
      'job:middleman-complete',
      event,
    );
  }

  middlemanError(event: MiddlemanErrorEvent): void {
    this.flushJobChunk(event.jobId);
    this.clearJobChunkState(event.jobId);
    this.emitToJobRooms(
      event.projectId,
      event.jobId,
      'job:middleman-error',
      event,
    );
  }

  workerStatus(event: WorkerStatusEvent): void {
    this.emitToJobRooms(
      event.projectId,
      event.jobId,
      'job:worker-status',
      event,
    );
  }

  progress(event: JobProgressEvent): void {
    const now = Date.now();
    const lastAt = this.lastProgressAt.get(event.jobId) ?? 0;
    const isBoundary = event.percent <= 0 || event.percent >= 100;
    if (!isBoundary && now - lastAt < PROGRESS_MIN_INTERVAL_MS) {
      return;
    }
    this.lastProgressAt.set(event.jobId, now);
    this.emitToJobRooms(event.projectId, event.jobId, 'job:progress', event);
  }

  completed(event: JobCompletedEvent): void {
    this.clearJobChunkState(event.jobId);
    this.lastProgressAt.delete(event.jobId);
    this.emitToJobRooms(event.projectId, event.jobId, 'job:completed', event);
  }

  failed(event: JobFailedEvent): void {
    this.clearJobChunkState(event.jobId);
    this.lastProgressAt.delete(event.jobId);
    this.emitToJobRooms(event.projectId, event.jobId, 'job:failed', event);
  }

  vaultFileUpdated(event: VaultFileUpdatedEvent): void {
    if (!this.server) {
      this.logger.debug(
        `[vault:file-updated] project=${event.projectId} file=${event.file.id}`,
      );
      return;
    }
    this.server
      .to(roomForProject(event.projectId))
      .emit('vault:file-updated', event);
  }

  providerHealth(event: ProviderHealthEvent): void {
    if (!this.server) {
      this.logger.debug(
        `[provider:health] provider=${event.providerConfigId} state=${event.state}`,
      );
      return;
    }
    this.server.emit('provider:health', event);
  }

  mcpInvocation(event: McpInvocationEvent): void {
    if (!this.server) {
      this.logger.debug(
        `[mcp:invocation] tool=${event.entry.toolName} transport=${event.entry.transport}`,
      );
      return;
    }
    this.server.emit('mcp:invocation', event);
  }

  private flushJobChunk(jobId: string): void {
    const state = this.chunkStates.get(jobId);
    if (!state || !state.pending) {
      return;
    }
    if (state.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }
    const payload = state.pending;
    state.pending = null;
    state.lastEmitAt = Date.now();
    this.emitToJobRooms(
      payload.projectId,
      payload.jobId,
      'job:middleman-chunk',
      payload,
    );
  }

  private clearJobChunkState(jobId: string): void {
    const state = this.chunkStates.get(jobId);
    if (state?.timer) {
      clearTimeout(state.timer);
    }
    this.chunkStates.delete(jobId);
  }

  private emitToJobRooms<K extends keyof ServerToClientEvents>(
    projectId: string,
    jobId: string,
    eventName: K,
    ...args: Parameters<ServerToClientEvents[K]>
  ): void {
    if (!this.server) {
      this.logger.debug(`[${String(eventName)}] job=${jobId}`);
      return;
    }
    const rooms = [roomForProject(projectId), roomForJob(jobId)];
    this.server.to(rooms).emit(eventName, ...args);
  }
}
