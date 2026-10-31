import { z } from 'zod';

export const RunPodOutputAssetMappingSchema = z.object({
  path: z.string().min(1),
  encoding: z.enum(['base64', 'url', 'text', 'data_uri']),
  mimeType: z.string().optional(),
  role: z
    .enum([
      'PRIMARY',
      'PREVIEW',
      'STEM',
      'FRAME',
      'TEXTURE_BASE_COLOR',
      'TEXTURE_NORMAL',
      'TEXTURE_ORM',
      'METADATA',
    ])
    .default('PRIMARY'),
});

export const OutputMappingSchema = z.object({
  assets: z.array(RunPodOutputAssetMappingSchema).min(1),
  progressPath: z.string().optional(),
  errorPath: z.string().optional(),
  metadataPath: z.string().optional(),
});

export const ProviderSettingsSchema = z
  .object({
    timeoutMs: z.number().int().min(1000).max(3_600_000).default(120_000),
    pollIntervalMs: z.number().int().min(250).max(60_000).default(2000),
    maxPollIntervalMs: z.number().int().min(1000).max(120_000).default(15_000),
    maxConcurrency: z.number().int().min(1).max(32).default(2),
    costPerSecondUsd: z.number().min(0).default(0),
    costPerRequestUsd: z.number().min(0).default(0),
    executionTimeoutMs: z.number().int().min(10_000).max(86_400_000).default(600_000),
    ttlMs: z.number().int().min(60_000).max(604_800_000).default(86_400_000),
    useWebhook: z.boolean().default(false),
    path: z.string().optional(),
    supportsJsonMode: z.boolean().optional(),
    webAuthMode: z.enum(['gemini_guest', 'gemini_auth', 'aistudio']).optional(),
    browserHeadless: z.boolean().default(true),
    autoDeleteCreatedChats: z.boolean().default(false),
    autoRetry: z.boolean().default(true),
    maxAttempts: z.number().int().min(1).max(10).default(3),
  })
  .partial();

export const ModelOptionSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  modalities: z
    .array(
      z.enum([
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
    .default([]),
  roles: z.array(z.enum(['LLM', 'VISION', 'GENERATOR'])).default(['GENERATOR']),
  notes: z.string().optional(),
});

export const UpsertProviderSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    kind: z.enum([
      'ANTHROPIC',
      'OPENAI',
      'GEMINI',
      'GOOGLE_WEB',
      'FAL',
      'REPLICATE',
      'STABILITY',
      'MESHY',
      'TRIPO3D',
      'RODIN',
      'ELEVENLABS',
      'CARTESIA',
      'FISH_AUDIO',
      'RUNPOD_SERVERLESS',
      'COMFYUI',
      'A1111',
      'OLLAMA',
      'OPENAI_COMPATIBLE',
      'GENERIC_HTTP',
      'DEMO',
    ]),
    tier: z.enum(['CLOUD_API', 'RUNPOD', 'LOCAL']),
    roles: z.array(z.enum(['LLM', 'VISION', 'GENERATOR'])).min(1),
    modalities: z
      .array(
        z.enum([
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
      .default([]),
    baseUrl: z.string().url().nullable().optional(),
    /** write-only. undefined = keep existing, null = clear, string = replace */
    secret: z.string().min(1).max(4096).nullable().optional(),
    runpodEndpointId: z
      .string()
      .regex(/^[a-z0-9]{6,40}$/i)
      .nullable()
      .optional(),
    defaultModel: z.string().max(200).nullable().optional(),
    models: z.array(ModelOptionSchema).default([]),
    payloadTemplate: z.record(z.unknown()).nullable().optional(),
    outputMapping: OutputMappingSchema.nullable().optional(),
    workflowTemplate: z.record(z.unknown()).nullable().optional(),
    extraHeaders: z.record(z.string()).default({}),
    settings: ProviderSettingsSchema.default({}),
    defaultForModalities: z
      .array(
        z.enum([
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
      .default([]),
    isEnabled: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.kind === 'RUNPOD_SERVERLESS' && !v.runpodEndpointId) {
      ctx.addIssue({
        code: 'custom',
        path: ['runpodEndpointId'],
        message: 'RunPod endpoint ID is required',
      });
    }
    if (['RUNPOD_SERVERLESS', 'GENERIC_HTTP'].includes(v.kind) && !v.payloadTemplate) {
      ctx.addIssue({
        code: 'custom',
        path: ['payloadTemplate'],
        message: 'Payload template is required',
      });
    }
    if (['RUNPOD_SERVERLESS', 'GENERIC_HTTP'].includes(v.kind) && !v.outputMapping) {
      ctx.addIssue({
        code: 'custom',
        path: ['outputMapping'],
        message: 'Output mapping is required',
      });
    }
    if (v.kind === 'COMFYUI' && !v.workflowTemplate) {
      ctx.addIssue({
        code: 'custom',
        path: ['workflowTemplate'],
        message: 'ComfyUI workflow (API format) is required',
      });
    }
    if (
      ['COMFYUI', 'A1111', 'OLLAMA', 'OPENAI_COMPATIBLE', 'GENERIC_HTTP'].includes(v.kind) &&
      !v.baseUrl
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['baseUrl'],
        message: 'Base URL is required',
      });
    }
  });

export const TemplatePreviewSchema = z.object({
  template: z.record(z.unknown()),
  variables: z.record(z.unknown()),
});

export type RunPodOutputAssetMapping = z.infer<typeof RunPodOutputAssetMappingSchema>;
export type OutputMapping = z.infer<typeof OutputMappingSchema>;
export type ProviderSettings = z.infer<typeof ProviderSettingsSchema>;
export type ModelOption = z.infer<typeof ModelOptionSchema>;
export type UpsertProviderDto = z.infer<typeof UpsertProviderSchema>;
export type TemplatePreviewDto = z.infer<typeof TemplatePreviewSchema>;
