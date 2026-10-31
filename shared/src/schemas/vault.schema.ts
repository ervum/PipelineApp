import { z } from 'zod';
import { IdSchema } from './common.schema';

const ContextScopeEnum = z.enum([
  'ALWAYS_INCLUDE',
  'ICONS_2D',
  'ASSETS_3D',
  'IMAGES',
  'VIDEO',
  'LORE',
  'MUSIC',
  'VOICES',
  'SFX',
  'OTHER',
]);

export const CreateFolderSchema = z.object({
  parentId: IdSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^/\\]+$/),
});

export const UpdateFolderSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1)
    .max(80)
    .regex(/^[^/\\]+$/)
    .optional(),
  parentId: IdSchema.optional(),
  sortOrder: z.number().int().optional(),
});

export const CreateTextFileSchema = z.object({
  folderId: IdSchema,
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/\.(md|txt|json)$/i),
  contentText: z.string().max(500_000).default(''),
  scopes: z.array(ContextScopeEnum).default([]),
  priority: z.number().int().min(0).max(100).default(50),
  description: z.string().max(500).default(''),
});

export const UpdateVaultFileSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  folderId: IdSchema.optional(),
  contentText: z.string().max(500_000).optional(),
  scopes: z.array(ContextScopeEnum).optional(),
  priority: z.number().int().min(0).max(100).optional(),
  description: z.string().max(500).optional(),
  styleDescriptorText: z.string().max(8000).nullable().optional(),
});

/** multipart fields accompanying binary upload (file field name: "file") */
export const UploadVaultFileFieldsSchema = z.object({
  folderId: IdSchema,
  scopes: z
    .string()
    .default('[]')
    .transform((s) => z.array(ContextScopeEnum).parse(JSON.parse(s))),
  priority: z.coerce.number().int().min(0).max(100).default(50),
  runVision: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export const AnalyzeVisionSchema = z.object({
  middlemanProfileId: IdSchema.optional(),
});

export const VaultSearchQuerySchema = z.object({
  q: z.string().max(120).default(''),
  scope: ContextScopeEnum.optional(),
  kind: z.enum(['MARKDOWN', 'TEXT', 'JSON', 'IMAGE', 'AUDIO', 'MODEL_3D', 'OTHER']).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type CreateFolderDto = z.infer<typeof CreateFolderSchema>;
export type UpdateFolderDto = z.infer<typeof UpdateFolderSchema>;
export type CreateTextFileDto = z.infer<typeof CreateTextFileSchema>;
export type UpdateVaultFileDto = z.infer<typeof UpdateVaultFileSchema>;
export type UploadVaultFileFieldsDto = z.infer<typeof UploadVaultFileFieldsSchema>;
export type AnalyzeVisionDto = z.infer<typeof AnalyzeVisionSchema>;
export type VaultSearchQueryDto = z.infer<typeof VaultSearchQuerySchema>;
