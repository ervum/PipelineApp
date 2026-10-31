import { z } from 'zod';
import { IdSchema } from './common.schema';
import { ModalityParamsSchema } from './modality-params.schema';

export const CompiledPromptSchema = z.object({
  assetTitle: z.string().trim().min(1).max(80),
  enhancedPrompt: z.string().trim().min(1).max(8000),
  negativePrompt: z.string().max(2000).default(''),
  recommendedParams: z
    .record(z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.string())]))
    .default({}),
  contextSourcesUsed: z
    .array(
      z.object({
        fileId: z.string(),
        fileName: z.string(),
        reasoningNote: z.string().max(280),
      }),
    )
    .default([]),
  warnings: z.array(z.string().max(280)).max(10).default([]),
});
export type CompiledPrompt = z.infer<typeof CompiledPromptSchema>;

export const UpsertMiddlemanProfileSchema = z.object({
  name: z.string().trim().min(2).max(80),
  providerConfigId: IdSchema,
  model: z.string().min(1).max(200),
  temperature: z.number().min(0).max(2).default(0.4),
  maxOutputTokens: z.number().int().min(256).max(16_000).default(1600),
  maxContextTokens: z.number().int().min(1000).max(400_000).default(12_000),
  supportsVision: z.boolean().default(false),
  attachReferenceImages: z.boolean().default(false),
  maxReferenceImages: z.number().int().min(0).max(8).default(3),
  jsonMode: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  isVisionDefault: z.boolean().default(false),
});

export const UpsertMiddlemanTemplateSchema = z.object({
  projectId: IdSchema.nullable().default(null),
  modality: z.enum([
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
  name: z.string().trim().min(2).max(120),
  systemTemplate: z.string().min(50).max(30_000),
  defaultNegativePrompt: z.string().max(2000).default(''),
  hardConstraints: z.string().max(5000).default(''),
});

/** Stateless compile preview (does not create a job) */
export const CompilePreviewSchema = z.object({
  projectId: IdSchema,
  modality: z.enum([
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
  rawPrompt: z.string().trim().min(1).max(4000),
  pinnedFileIds: z.array(IdSchema).max(12).default([]),
  params: z.lazy(() => ModalityParamsSchema),
  providerConfigId: IdSchema,
  middlemanProfileId: IdSchema.optional(),
});

export type UpsertMiddlemanProfileDto = z.infer<typeof UpsertMiddlemanProfileSchema>;
export type UpsertMiddlemanTemplateDto = z.infer<typeof UpsertMiddlemanTemplateSchema>;
export type CompilePreviewDto = z.infer<typeof CompilePreviewSchema>;
