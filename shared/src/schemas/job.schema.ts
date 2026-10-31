import { z } from 'zod';
import { IdSchema } from './common.schema';
import { CompiledPromptSchema } from './middleman.schema';
import {
  Assets3DParamsSchema,
  ModalityParamsSchema,
  VideoParamsSchema,
} from './modality-params.schema';

export const CreateJobSchema = z
  .object({
    projectId: IdSchema,
    executionMode: z.enum(['AUTO_FIRE', 'INTERCEPT']),
    rawPrompt: z.string().trim().min(1).max(4000),
    pinnedFileIds: z.array(IdSchema).max(12).default([]),
    params: ModalityParamsSchema,
    /** Adapter-level ParamSpec overrides from the Advanced panel; merged last into mergedParams. */
    advanced: z.record(z.union([z.string(), z.number(), z.boolean()])).default({}),
    providerConfigId: IdSchema,
    providerModel: z.string().max(200).nullable().default(null),
    middlemanProfileId: IdSchema.nullable().default(null),
    skipMiddleman: z.boolean().default(false),
    parentAssetId: IdSchema.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    if (v.params.modality === 'VOICES' && v.params.transcript.trim().length === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['params', 'transcript'],
        message: 'Transcript is required for voice generation',
      });
    }
    if (v.params.modality === 'ASSETS_3D') {
      const r = Assets3DParamsSchema.safeParse(v.params);
      if (!r.success) {
        r.error.issues.forEach((i) => ctx.addIssue({ ...i, path: ['params', ...i.path] }));
      }
    }
    if (v.params.modality === 'VIDEO') {
      const r = VideoParamsSchema.safeParse(v.params);
      if (!r.success) {
        r.error.issues.forEach((i) => ctx.addIssue({ ...i, path: ['params', ...i.path] }));
      }
    }
  });

export const UpdateCompiledSchema = z.object({
  compiled: CompiledPromptSchema,
});

export const RecompileSchema = z.object({
  rawPrompt: z.string().trim().min(1).max(4000).optional(),
  pinnedFileIds: z.array(IdSchema).max(12).optional(),
});

export const JobListQuerySchema = z.object({
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
  status: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(',') : undefined)),
  active: z.enum(['true', 'false']).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
  cursor: z.string().optional(),
});

export type CreateJobDto = z.infer<typeof CreateJobSchema>;
export type UpdateCompiledDto = z.infer<typeof UpdateCompiledSchema>;
export type RecompileDto = z.infer<typeof RecompileSchema>;
export type JobListQueryDto = z.infer<typeof JobListQuerySchema>;
