import {
  AdapterDescriptor,
  AssetFileRole,
  CompiledPrompt,
  ErrorCode,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ModalityParams,
  ProviderKind,
  WorkerStatusEvent,
} from '@forge/shared';
import { GenerationJob, Project, VoiceProfile } from '@prisma/client';
import { ProviderRuntimeConfig } from '../providers/providers.service';

export const GENERATOR_ADAPTERS = Symbol('GENERATOR_ADAPTERS');

export interface GeneratorReferenceFile {
  storageKey: string;
  mimeType: string;
  base64: () => Promise<string>;
  dataUri: () => Promise<string>;
  publicUrl: string | null;
}

export interface GeneratorDispatchContext {
  job: GenerationJob;
  project: Project;
  provider: ProviderRuntimeConfig;
  modality: Modality;
  subMode: GenerationSubMode;
  params: ModalityParams;
  compiled: CompiledPrompt;
  mergedParams: Record<string, unknown>;
  seed: number;
  references: GeneratorReferenceFile[];
  voiceProfile: VoiceProfile | null;
  webhookUrl: string | null;
  signal: AbortSignal;
  reportProgress(p: { percent: number; stage: string; message?: string }): void;
  reportWorker(
    w: Omit<
      WorkerStatusEvent,
      'jobId' | 'projectId' | 'at' | 'tier' | 'providerKind'
    >,
  ): void;
  log(message: string, payload?: unknown): void;
}

export interface GeneratorOutput {
  kind: 'buffer' | 'base64' | 'url' | 'text';
  data: Buffer | string;
  mimeType: string;
  fileName: string;
  role: AssetFileRole;
  batchIndex: number;
  metadata?: Record<string, unknown>;
}

export type GeneratorSubmitResult =
  | {
      mode: 'sync';
      outputs: GeneratorOutput[];
      costUsd?: number;
      executionMs?: number;
    }
  | {
      mode: 'async';
      externalJobId: string;
      handle: Record<string, unknown>;
      initialStatus: 'COLD_START' | 'RUNNING';
      pollAfterMs: number;
    };

export type GeneratorPollResult =
  | {
      state: 'pending';
      coldStart: boolean;
      externalStatus: string;
      progress?: number;
      pollAfterMs?: number;
      queueDelayMs?: number;
    }
  | {
      state: 'completed';
      outputs: GeneratorOutput[];
      externalStatus: string;
      costUsd?: number;
      executionMs?: number;
      queueDelayMs?: number;
    }
  | {
      state: 'failed';
      externalStatus: string;
      code: ErrorCode;
      message: string;
      retryable: boolean;
    };

export interface IGeneratorAdapter {
  readonly id: string;
  readonly providerKind: ProviderKind;
  readonly supportedProviderKinds?: readonly ProviderKind[];
  readonly modalities: readonly Modality[];
  readonly subModes: readonly GenerationSubMode[];
  readonly tier: ExecutionTier | 'ANY';
  readonly supportsNativeTransparency?: boolean;

  describe(
    modality: Modality,
    subMode: GenerationSubMode,
    provider?: ProviderRuntimeConfig,
  ): AdapterDescriptor;
  submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult>;
  poll?(
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
  ): Promise<GeneratorPollResult>;
  cancel?(
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
  ): Promise<void>;
}
