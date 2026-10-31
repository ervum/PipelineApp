import {
  CompiledPrompt,
  ContextFileRef,
  ExecutionMode,
  ExecutionTier,
  GenerationSubMode,
  JobEventModel,
  JobModel,
  JobStatus,
  Modality,
  ModalityParams,
  ProviderKind,
} from '@forge/shared';
import { GenerationJob, GenerationJobEvent } from '@prisma/client';

export type GenerationJobWithRelations = GenerationJob & {
  providerConfig: {
    id: string;
    name: string;
    kind: string;
  };
  middlemanProfile?: {
    id: string;
    name: string;
  } | null;
  assets?: Array<{ id: string }>;
};

export function toJobModel(
  row: GenerationJobWithRelations,
  contextFiles: ContextFileRef[] = [],
): JobModel {
  const compiled =
    typeof row.compiledPayload === 'object' && row.compiledPayload !== null
      ? (row.compiledPayload as unknown as CompiledPrompt)
      : null;

  const edited =
    typeof row.editedPayload === 'object' && row.editedPayload !== null
      ? (row.editedPayload as unknown as CompiledPrompt)
      : null;

  const derivedContextFiles: ContextFileRef[] =
    contextFiles.length > 0
      ? contextFiles
      : (compiled?.contextSourcesUsed ?? []).map((src) => ({
          fileId: src.fileId,
          fileName: src.fileName,
          folderPath: '/',
          reason: row.pinnedFileIds.includes(src.fileId) ? 'PINNED' : 'SCOPE',
          tokens: 0,
          truncated: false,
        }));

  return {
    id: row.id,
    projectId: row.projectId,
    modality: row.modality as Modality,
    subMode: row.subMode as GenerationSubMode,
    executionMode: row.executionMode as ExecutionMode,
    status: row.status as JobStatus,
    rawPrompt: row.rawPrompt,
    pinnedFileIds: row.pinnedFileIds,
    params: row.userParams as unknown as ModalityParams,
    compiled,
    edited,
    contextFiles: derivedContextFiles,
    providerConfigId: row.providerConfigId,
    providerName: row.providerConfig.name,
    providerKind: row.providerConfig.kind as ProviderKind,
    providerModel: row.providerModel,
    tier: row.tier as ExecutionTier,
    middlemanProfileId: row.middlemanProfileId,
    middlemanProfileName: row.middlemanProfile?.name ?? null,
    externalJobId: row.externalJobId,
    externalStatus: row.externalStatus,
    progressPercent: row.progressPercent,
    progressStage: row.progressStage,
    coldStartMs: row.coldStartMs,
    queueDelayMs: row.queueDelayMs,
    executionMs: row.executionMs,
    costUsd: row.costUsd !== null ? Number(row.costUsd) : null,
    errorCode: row.errorCode,
    errorMessage: row.errorMessage,
    attempt: row.attempt,
    assetIds: (row.assets ?? []).map((a) => a.id),
    createdAt: row.createdAt.toISOString(),
    dispatchedAt: row.dispatchedAt ? row.dispatchedAt.toISOString() : null,
    startedAt: row.startedAt ? row.startedAt.toISOString() : null,
    completedAt: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export function toJobEventModel(row: GenerationJobEvent): JobEventModel {
  return {
    id: row.id,
    type: row.type,
    fromStatus: (row.fromStatus as JobStatus | null) ?? null,
    toStatus: (row.toStatus as JobStatus | null) ?? null,
    message: row.message,
    payload: row.payload,
    createdAt: row.createdAt.toISOString(),
  };
}
