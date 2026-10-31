export const VaultFileKind = {
  MARKDOWN: 'MARKDOWN',
  TEXT: 'TEXT',
  JSON: 'JSON',
  IMAGE: 'IMAGE',
  AUDIO: 'AUDIO',
  MODEL_3D: 'MODEL_3D',
  OTHER: 'OTHER',
} as const;
export type VaultFileKind = (typeof VaultFileKind)[keyof typeof VaultFileKind];
export const VAULT_FILE_KINDS: readonly VaultFileKind[] = Object.values(VaultFileKind);

export const VisionStatus = {
  NONE: 'NONE',
  PENDING: 'PENDING',
  RUNNING: 'RUNNING',
  DONE: 'DONE',
  FAILED: 'FAILED',
} as const;
export type VisionStatus = (typeof VisionStatus)[keyof typeof VisionStatus];
export const VISION_STATUSES: readonly VisionStatus[] = Object.values(VisionStatus);
