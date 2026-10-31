export const ApprovalStatus = {
  DRAFT: 'DRAFT',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  FINAL: 'FINAL',
} as const;
export type ApprovalStatus = (typeof ApprovalStatus)[keyof typeof ApprovalStatus];
export const APPROVAL_STATUSES: readonly ApprovalStatus[] = Object.values(ApprovalStatus);

export const AssetFileRole = {
  PRIMARY: 'PRIMARY',
  THUMBNAIL: 'THUMBNAIL',
  PREVIEW: 'PREVIEW',
  VARIANT_512: 'VARIANT_512',
  VARIANT_128: 'VARIANT_128',
  VARIANT_64: 'VARIANT_64',
  VARIANT_32: 'VARIANT_32',
  TEXTURE_BASE_COLOR: 'TEXTURE_BASE_COLOR',
  TEXTURE_NORMAL: 'TEXTURE_NORMAL',
  TEXTURE_ORM: 'TEXTURE_ORM',
  STEM: 'STEM',
  FRAME: 'FRAME',
  ALIGNMENT: 'ALIGNMENT',
  METADATA: 'METADATA',
  SOURCE_REFERENCE: 'SOURCE_REFERENCE',
  LOD1: 'LOD1',
  LOD2: 'LOD2',
} as const;
export type AssetFileRole = (typeof AssetFileRole)[keyof typeof AssetFileRole];
export const ASSET_FILE_ROLES: readonly AssetFileRole[] = Object.values(AssetFileRole);

export const GenerationSubMode = {
  STANDARD: 'STANDARD',
  TEXT_TO_3D: 'TEXT_TO_3D',
  IMAGE_TO_3D: 'IMAGE_TO_3D',
  TEXT_TO_VIDEO: 'TEXT_TO_VIDEO',
  IMAGE_TO_VIDEO: 'IMAGE_TO_VIDEO',
  SPRITESHEET: 'SPRITESHEET',
  VFX_TEXTURE: 'VFX_TEXTURE',
  SHADER_CODE: 'SHADER_CODE',
  LORE_JSON: 'LORE_JSON',
} as const;
export type GenerationSubMode = (typeof GenerationSubMode)[keyof typeof GenerationSubMode];
export const GENERATION_SUB_MODES: readonly GenerationSubMode[] = Object.values(GenerationSubMode);
