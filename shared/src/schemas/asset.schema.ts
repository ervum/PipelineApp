import { z } from 'zod';
import { IdSchema } from './common.schema';

export const AssetListQuerySchema = z.object({
  projectId: IdSchema,
  modality: z
    .enum([
      'ICONS_2D',
      'ASSETS_3D',
      'IMAGES',
      'VIDEO',
      'LORE',
      'MUSIC',
      'VOICES',
      'SFX',
      'OTHER',
    ])
    .optional(),
  approval: z.enum(['DRAFT', 'APPROVED', 'REJECTED', 'FINAL']).optional(),
  favorite: z.enum(['true', 'false']).optional(),
  tier: z.enum(['CLOUD_API', 'RUNPOD', 'LOCAL']).optional(),
  q: z.string().max(120).optional(),
  sort: z.enum(['newest', 'oldest', 'cost', 'duration']).default('newest'),
  limit: z.coerce.number().int().min(1).max(100).default(40),
  cursor: z.string().optional(),
});

export const UpdateAssetSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  approval: z.enum(['DRAFT', 'APPROVED', 'REJECTED', 'FINAL']).optional(),
  isFavorite: z.boolean().optional(),
  tags: z.array(z.string().trim().min(1).max(32)).max(20).optional(),
  notes: z.string().max(5000).optional(),
});

export const SaveAssetToVaultSchema = z.object({
  folderId: IdSchema,
  scopes: z
    .array(
      z.enum([
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
      ]),
    )
    .min(1),
  runVision: z.boolean().default(true),
  fileRole: z.enum(['PRIMARY', 'THUMBNAIL', 'PREVIEW']).default('PRIMARY'),
});

export type AssetListQueryDto = z.infer<typeof AssetListQuerySchema>;
export type UpdateAssetDto = z.infer<typeof UpdateAssetSchema>;
export type SaveAssetToVaultDto = z.infer<typeof SaveAssetToVaultSchema>;
