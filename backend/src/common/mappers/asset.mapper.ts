import {
  ApprovalStatus,
  AssetFileModel,
  AssetFileRole,
  AssetMetadata,
  AssetModel,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { GeneratedAsset, GeneratedAssetFile } from '@prisma/client';

export type GeneratedAssetWithRelations = GeneratedAsset & {
  files: GeneratedAssetFile[];
  savedToVault?: { id: string } | null;
  providerName?: string | null;
};

export function toAssetFileModel(row: GeneratedAssetFile): AssetFileModel {
  const url = `/api/v1/media/assets/${row.id}`;
  return {
    id: row.id,
    role: row.role as AssetFileRole,
    url,
    downloadUrl: `${url}?download=1`,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    format: row.format,
  };
}

export function toAssetModel(
  row: GeneratedAssetWithRelations,
  providerNameLookup?: Map<string, string>,
): AssetModel {
  const sortedFiles = [...row.files].sort((a, b) => a.sortIndex - b.sortIndex);
  const fileModels = sortedFiles.map(toAssetFileModel);

  const primaryFile =
    fileModels.find((f) => f.role === AssetFileRole.PRIMARY) ?? fileModels[0];
  const thumbFile =
    fileModels.find((f) => f.role === AssetFileRole.THUMBNAIL) ??
    fileModels.find((f) => f.role === AssetFileRole.PREVIEW) ??
    null;

  const providerName =
    row.providerName ??
    (row.providerConfigId ? (providerNameLookup?.get(row.providerConfigId) ?? null) : null);

  return {
    id: row.id,
    projectId: row.projectId,
    jobId: row.jobId,
    modality: row.modality as Modality,
    subMode: row.subMode as GenerationSubMode,
    title: row.title,
    assetGroupId: row.assetGroupId,
    version: row.version,
    batchIndex: row.batchIndex,
    parentAssetId: row.parentAssetId,
    rawPrompt: row.rawPrompt,
    enhancedPrompt: row.enhancedPrompt,
    negativePrompt: row.negativePrompt,
    approval: row.approval as ApprovalStatus,
    isFavorite: row.isFavorite,
    tags: row.tags,
    notes: row.notes,
    metadata: row.metadata as unknown as AssetMetadata,
    providerKind: row.providerKind as ProviderKind,
    providerName,
    providerModel: row.providerModel,
    tier: row.tier as ExecutionTier,
    costUsd: row.costUsd !== null ? Number(row.costUsd) : null,
    executionMs: row.executionMs,
    seed: row.seed,
    files: fileModels,
    primaryUrl: primaryFile ? primaryFile.url : '',
    thumbnailUrl: thumbFile ? thumbFile.url : null,
    savedToVaultFileId: row.savedToVault?.id ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
