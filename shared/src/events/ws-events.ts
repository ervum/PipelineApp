import { ErrorCode, ExecutionTier, HealthState, JobStatus, ProviderKind } from '../enums';
import {
  AssetModel,
  ContextFileRef,
  JobModel,
  LlmUsage,
  McpInvocationLogEntry,
  VaultFileModel,
} from '../models';
import { CompiledPrompt } from '../schemas';

export const WS_NAMESPACE = '/orchestrator';

export interface JobCreatedEvent {
  job: JobModel;
}

export interface JobStatusEvent {
  jobId: string;
  projectId: string;
  from: JobStatus;
  to: JobStatus;
  at: string;
  message: string;
}

export interface MiddlemanChunkEvent {
  jobId: string;
  projectId: string;
  seq: number;
  delta: string;
  accumulatedChars: number;
}

export interface MiddlemanCompleteEvent {
  jobId: string;
  projectId: string;
  compiled: CompiledPrompt;
  contextFiles: ContextFileRef[];
  usage: LlmUsage;
  nextStatus: 'AWAITING_REVIEW' | 'READY';
}

export interface MiddlemanErrorEvent {
  jobId: string;
  projectId: string;
  code: ErrorCode;
  message: string;
  rawOutputExcerpt: string;
}

export interface WorkerStatusEvent {
  jobId: string;
  projectId: string;
  tier: ExecutionTier;
  providerKind: ProviderKind;
  externalJobId: string | null;
  externalStatus: string;
  phase: 'SUBMITTED' | 'IN_QUEUE' | 'COLD_START' | 'WARM' | 'RUNNING' | 'UPLOADING' | 'DONE';
  coldStart: boolean;
  queueDelayMs: number | null;
  workers: {
    idle: number;
    running: number;
    initializing: number;
    throttled: number;
  } | null;
  at: string;
}

export interface JobProgressEvent {
  jobId: string;
  projectId: string;
  percent: number;
  stage: string;
  message: string;
  etaMs: number | null;
}

export interface JobCompletedEvent {
  jobId: string;
  projectId: string;
  assets: AssetModel[];
  costUsd: number | null;
  executionMs: number | null;
}

export interface JobFailedEvent {
  jobId: string;
  projectId: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface VaultFileUpdatedEvent {
  projectId: string;
  file: VaultFileModel;
}

export interface ProviderHealthEvent {
  providerConfigId: string;
  state: HealthState;
  latencyMs: number | null;
  message: string | null;
}

export interface McpInvocationEvent {
  entry: McpInvocationLogEntry;
  totalInvocations: number;
}

export interface ServerToClientEvents {
  'job:created': (p: JobCreatedEvent) => void;
  'job:status': (p: JobStatusEvent) => void;
  'job:middleman-chunk': (p: MiddlemanChunkEvent) => void;
  'job:middleman-complete': (p: MiddlemanCompleteEvent) => void;
  'job:middleman-error': (p: MiddlemanErrorEvent) => void;
  'job:worker-status': (p: WorkerStatusEvent) => void;
  'job:progress': (p: JobProgressEvent) => void;
  'job:completed': (p: JobCompletedEvent) => void;
  'job:failed': (p: JobFailedEvent) => void;
  'vault:file-updated': (p: VaultFileUpdatedEvent) => void;
  'provider:health': (p: ProviderHealthEvent) => void;
  'mcp:invocation': (p: McpInvocationEvent) => void;
}

export interface Ack {
  ok: boolean;
  error?: string;
}

export interface ClientToServerEvents {
  'studio:subscribe-project': (p: { projectId: string }, ack: (a: Ack) => void) => void;
  'studio:unsubscribe-project': (p: { projectId: string }, ack: (a: Ack) => void) => void;
  'job:subscribe': (
    p: { jobId: string },
    ack: (a: Ack & { replay?: MiddlemanChunkEvent[] }) => void,
  ) => void;
}

export const roomForProject = (id: string): string => `project:${id}`;
export const roomForJob = (id: string): string => `job:${id}`;
