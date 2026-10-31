import {
  ContextScope,
  StyleDescriptor,
  VaultFileDetailModel,
  VaultFileKind,
  VaultFileModel,
  VaultFolderModel,
  VisionStatus,
  VoiceProfileModel,
} from '@forge/shared';
import { VaultFile, VaultFolder, VoiceProfile } from '@prisma/client';

export type VaultFolderWithCount = VaultFolder & {
  _count?: { files: number };
};

export type VaultFileWithFolder = VaultFile & {
  folder?: { path: string };
};

export type VoiceProfileWithRelations = VoiceProfile & {
  characterSheet?: { id: string; name: string } | null;
  providerConfig?: { id: string; name: string } | null;
};

export function toVaultFolderModel(
  row: VaultFolderWithCount,
  children: VaultFolderModel[] = [],
): VaultFolderModel {
  return {
    id: row.id,
    projectId: row.projectId,
    parentId: row.parentId,
    name: row.name,
    path: row.path,
    sortOrder: row.sortOrder,
    fileCount: row._count?.files ?? 0,
    children,
  };
}

export function toVaultFileModel(row: VaultFileWithFolder): VaultFileModel {
  return {
    id: row.id,
    projectId: row.projectId,
    folderId: row.folderId,
    folderPath: row.folder?.path ?? '/',
    name: row.name,
    extension: row.extension,
    kind: row.kind as VaultFileKind,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    scopes: row.scopes as ContextScope[],
    priority: row.priority,
    description: row.description,
    tokenEstimate: row.tokenEstimate,
    contentUrl: row.storageKey || row.contentText !== null ? `/api/v1/media/vault/${row.id}` : null,
    thumbnailUrl: row.thumbnailKey ? `/api/v1/media/vault/${row.id}/thumbnail` : null,
    styleDescriptorText: row.styleDescriptorText,
    styleDescriptorJson: (row.styleDescriptorJson as StyleDescriptor | null) ?? null,
    visionStatus: row.visionStatus as VisionStatus,
    visionModel: row.visionModel,
    visionError: row.visionError,
    width: row.width,
    height: row.height,
    durationMs: row.durationMs,
    sourceAssetId: row.sourceAssetId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function toVaultFileDetailModel(row: VaultFileWithFolder): VaultFileDetailModel {
  return {
    ...toVaultFileModel(row),
    contentText: row.contentText,
  };
}

export function toVoiceProfileModel(row: VoiceProfileWithRelations): VoiceProfileModel {
  const defaultSettings =
    typeof row.defaultSettings === 'object' && row.defaultSettings !== null
      ? (row.defaultSettings as Record<string, unknown>)
      : {};
  return {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    characterSheetFileId: row.characterSheetFileId,
    characterSheetName: row.characterSheet?.name ?? null,
    providerConfigId: row.providerConfigId,
    providerName: row.providerConfig?.name ?? null,
    externalVoiceId: row.externalVoiceId,
    description: row.description,
    defaultSettings,
    sampleUrl: row.sampleStorageKey ? `/api/v1/media/voices/${row.id}/sample` : null,
  };
}
