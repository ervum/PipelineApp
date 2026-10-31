import {
  ExecutionMode,
  ExecutionTier,
  GenerationSubMode,
  JobStatus,
  Modality,
  ProviderKind,
} from '../enums';
import { CompiledPrompt } from '../schemas/middleman.schema';
import { ModalityParams } from '../schemas/modality-params.schema';
import { ContextFileRef } from './middleman.model';

export interface JobModel {
  id: string;
  projectId: string;
  modality: Modality;
  subMode: GenerationSubMode;
  executionMode: ExecutionMode;
  status: JobStatus;
  rawPrompt: string;
  pinnedFileIds: string[];
  params: ModalityParams;
  compiled: CompiledPrompt | null;
  edited: CompiledPrompt | null;
  contextFiles: ContextFileRef[];
  providerConfigId: string;
  providerName: string;
  providerKind: ProviderKind;
  providerModel: string | null;
  tier: ExecutionTier;
  middlemanProfileId: string | null;
  middlemanProfileName: string | null;
  externalJobId: string | null;
  externalStatus: string | null;
  progressPercent: number;
  progressStage: string | null;
  coldStartMs: number | null;
  queueDelayMs: number | null;
  executionMs: number | null;
  costUsd: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  attempt: number;
  assetIds: string[];
  createdAt: string;
  dispatchedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

export interface JobEventModel {
  id: string;
  type: string;
  fromStatus: JobStatus | null;
  toStatus: JobStatus | null;
  message: string;
  payload: unknown;
  createdAt: string;
}
