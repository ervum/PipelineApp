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

export const CreateArenaJobSchema = z.object({
  projectId: IdSchema,
  executionMode: z.enum(['AUTO_FIRE', 'INTERCEPT']).default('AUTO_FIRE'),
  rawPrompt: z.string().trim().min(1).max(4000),
  pinnedFileIds: z.array(IdSchema).max(12).default([]),
  params: ModalityParamsSchema,
  providerTargets: z
    .array(
      z.object({
        providerConfigId: IdSchema,
        providerModel: z.string().max(200).nullable().optional().default(null),
      }),
    )
    .min(2)
    .max(4),
  middlemanProfileId: IdSchema.nullable().default(null),
  skipMiddleman: z.boolean().default(false),
});

export const PipelineStepSchema = z.object({
  stepId: z.string().trim().min(1).max(64),
  rawPrompt: z.string().trim().min(1).max(4000),
  params: ModalityParamsSchema,
  providerConfigId: IdSchema,
  providerModel: z.string().max(200).nullable().optional().default(null),
  dependsOn: z.array(z.string()).default([]),
  outputs: z.record(z.string()).optional(),
});

export const RunPipelineSchema = z.object({
  projectId: IdSchema,
  name: z.string().trim().min(1).max(120).default('Multi-Step Pipeline'),
  steps: z.array(PipelineStepSchema).min(1).max(8),
  skipMiddleman: z.boolean().default(false),
});

export const BatchMatrixJobSchema = z.object({
  projectId: IdSchema,
  promptTemplate: z.string().trim().min(1).max(4000),
  rows: z.array(z.record(z.union([z.string(), z.number()]))).max(32).optional(),
  variables: z.record(z.array(z.string().min(1)).min(1).max(16)).optional(),
  params: ModalityParamsSchema,
  providerConfigId: IdSchema,
  providerModel: z.string().max(200).nullable().optional().default(null),
  executionMode: z.enum(['AUTO_FIRE', 'INTERCEPT']).default('AUTO_FIRE'),
  skipMiddleman: z.boolean().default(false),
});

export const DialogueTurnInputSchema = z.object({
  speaker: z.string().trim().min(1).max(80),
  text: z.string().trim().min(1).max(2000),
  voiceId: z.string().max(120).optional(),
  emotion: z.string().max(40).optional(),
  speed: z.number().min(0.7).max(1.3).optional(),
  pauseAfterMs: z.number().int().min(0).max(5000).optional(),
});

export const CreateDialogueSceneSchema = z.object({
  projectId: IdSchema,
  title: z.string().trim().min(1).max(160).default('Dialogue Scene'),
  scriptText: z.string().max(12_000).optional(),
  turns: z.array(DialogueTurnInputSchema).max(32).optional(),
  pauseBetweenTurnsMs: z.number().int().min(0).max(5000).default(320),
  seed: z.number().int().min(0).optional(),
});

export type CreateJobDto = z.infer<typeof CreateJobSchema>;
export type CreateArenaJobDto = z.infer<typeof CreateArenaJobSchema>;
export type PipelineStepDto = z.infer<typeof PipelineStepSchema>;
export type RunPipelineDto = z.infer<typeof RunPipelineSchema>;
export type BatchMatrixJobDto = z.infer<typeof BatchMatrixJobSchema>;
export type DialogueTurnInputDto = z.infer<typeof DialogueTurnInputSchema>;
export type CreateDialogueSceneDto = z.infer<typeof CreateDialogueSceneSchema>;
export type UpdateCompiledDto = z.infer<typeof UpdateCompiledSchema>;
export type RecompileDto = z.infer<typeof RecompileSchema>;
export type JobListQueryDto = z.infer<typeof JobListQuerySchema>;
