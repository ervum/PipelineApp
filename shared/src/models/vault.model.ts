import { ContextScope, VaultFileKind, VisionStatus } from '../enums';

export interface VaultFolderModel {
  id: string;
  projectId: string;
  parentId: string | null;
  name: string;
  path: string;
  sortOrder: number;
  fileCount: number;
  children: VaultFolderModel[];
}

export interface StyleDescriptor {
  paletteHex: string[];
  lighting: string;
  rendering: string;
  linework: string;
  proportions: string;
  materials: string;
  composition: string;
  mood: string;
  doNot: string[];
}

export interface VaultFileModel {
  id: string;
  projectId: string;
  folderId: string;
  folderPath: string;
  name: string;
  extension: string;
  kind: VaultFileKind;
  mimeType: string;
  sizeBytes: number;
  scopes: ContextScope[];
  priority: number;
  description: string;
  tokenEstimate: number;
  contentUrl: string | null;
  thumbnailUrl: string | null;
  styleDescriptorText: string | null;
  styleDescriptorJson: StyleDescriptor | null;
  visionStatus: VisionStatus;
  visionModel: string | null;
  visionError: string | null;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  sourceAssetId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VaultFileDetailModel extends VaultFileModel {
  contentText: string | null;
}
