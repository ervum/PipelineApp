import { z } from 'zod';
import { IdSchema } from './common.schema';

export const UpsertVoiceProfileSchema = z.object({
  name: z.string().trim().min(1).max(80),
  characterSheetFileId: IdSchema.nullable().default(null),
  providerConfigId: IdSchema.nullable().default(null),
  externalVoiceId: z.string().max(200).default(''),
  description: z.string().max(4000).default(''),
  defaultSettings: z
    .object({
      speed: z.number().min(0.7).max(1.3).optional(),
      stability: z.number().min(0).max(1).optional(),
      similarityBoost: z.number().min(0).max(1).optional(),
      style: z.number().min(0).max(1).optional(),
      emotionTags: z.array(z.string()).optional(),
    })
    .default({}),
});

export type UpsertVoiceProfileDto = z.infer<typeof UpsertVoiceProfileSchema>;
