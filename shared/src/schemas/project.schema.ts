import { z } from 'zod';
import { HexColorSchema } from './common.schema';

export const CreateProjectSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(60)
    .optional(),
  tagline: z.string().max(140).default(''),
  description: z.string().max(10_000).default(''),
  genre: z.string().max(60).default(''),
  accentHex: HexColorSchema.default('#7C3AED'),
  globalSummary: z.string().max(6000).default(''),
});

export const UpdateProjectSchema = CreateProjectSchema.partial().extend({
  archived: z.boolean().optional(),
});

export type CreateProjectDto = z.infer<typeof CreateProjectSchema>;
export type UpdateProjectDto = z.infer<typeof UpdateProjectSchema>;
