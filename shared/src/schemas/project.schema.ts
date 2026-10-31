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

export const ExportEngineSchema = z.enum(['GODOT', 'UNITY', 'ROBLOX', 'GENERIC']);
export type ExportEngine = z.infer<typeof ExportEngineSchema>;

export const ExportApprovalFilterSchema = z.enum(['FINAL_ONLY', 'APPROVED_AND_FINAL', 'ALL']);
export type ExportApprovalFilter = z.infer<typeof ExportApprovalFilterSchema>;

export const ExportProjectBundleSchema = z.object({
  targetEngine: ExportEngineSchema.default('GODOT'),
  approvalFilter: ExportApprovalFilterSchema.default('APPROVED_AND_FINAL'),
  includeLodFiles: z.boolean().default(true),
  includePbrMaps: z.boolean().default(true),
  syncToDir: z.string().trim().min(1).max(500).optional(),
});
export type ExportProjectBundleDto = z.infer<typeof ExportProjectBundleSchema>;

export const ConfigureSyncDirectorySchema = z.object({
  targetDir: z.string().trim().max(500).nullable(),
  targetEngine: ExportEngineSchema.default('GODOT'),
  autoSyncOnFinal: z.boolean().default(true),
});
export type ConfigureSyncDirectoryDto = z.infer<typeof ConfigureSyncDirectorySchema>;

