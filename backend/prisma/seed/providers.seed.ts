import {
  AiProviderConfig,
  ExecutionTier,
  HealthState,
  Modality,
  Prisma,
  ProviderKind,
  ProviderRole,
} from '@prisma/client';
import { GOOGLE_WEB_MODEL_CATALOG } from '@forge/shared';
import { SeedContext } from './seed-context';

export const RUNPOD_COMFY_WORKFLOW_INNER: Record<string, unknown> = {
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '{{enhanced_prompt}}', clip: ['30', 1] },
  },
  '33': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '{{negative_prompt}}', clip: ['30', 1] },
  },
  '31': {
    class_type: 'KSampler',
    inputs: {
      seed: '{{seed}}',
      steps: '{{steps}}',
      cfg: '{{cfg_scale}}',
      sampler_name: 'euler',
      scheduler: 'simple',
      denoise: 1,
      model: ['30', 0],
      positive: ['6', 0],
      negative: ['33', 0],
      latent_image: ['27', 0],
    },
  },
  '27': {
    class_type: 'EmptySD3LatentImage',
    inputs: {
      width: '{{width}}',
      height: '{{height}}',
      batch_size: '{{batch_count}}',
    },
  },
  '30': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'flux1-dev-fp8.safetensors' },
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: { samples: ['31', 0], vae: ['30', 2] },
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'forge_{{job_id}}', images: ['8', 0] },
  },
};

export interface SeededProvidersMap {
  byName: Record<string, AiProviderConfig>;
  demo: AiProviderConfig;
  anthropic: AiProviderConfig;
  openai: AiProviderConfig;
  gemini: AiProviderConfig;
  geminiWebGuest: AiProviderConfig;
  geminiWebAuth: AiProviderConfig;
  aiStudio: AiProviderConfig;
  fal: AiProviderConfig;
  replicate: AiProviderConfig;
  stability: AiProviderConfig;
  meshy: AiProviderConfig;
  tripo3d: AiProviderConfig;
  rodin: AiProviderConfig;
  elevenlabs: AiProviderConfig;
  cartesia: AiProviderConfig;
  fishAudio: AiProviderConfig;
  runpodComfy: AiProviderConfig;
  runpodTts: AiProviderConfig;
  localComfy: AiProviderConfig;
  localA1111: AiProviderConfig;
  localOllama: AiProviderConfig;
  lmStudio: AiProviderConfig;
  kokoroTts: AiProviderConfig;
  localF5Tts: AiProviderConfig;
}

interface ProviderSeedDef {
  name: string;
  kind: ProviderKind;
  tier: ExecutionTier;
  roles: ProviderRole[];
  modalities: Modality[];
  baseUrl?: string | null;
  envKey?: string;
  endpointEnvKey?: string;
  defaultModel?: string | null;
  models: Array<{
    id: string;
    label: string;
    modalities: Modality[];
    roles?: ProviderRole[];
    notes?: string;
  }>;
  payloadTemplate?: Record<string, unknown> | null;
  outputMapping?: Record<string, unknown> | null;
  workflowTemplate?: Record<string, unknown> | null;
  settings: Record<string, unknown>;
  defaultForModalities?: Modality[];
  alwaysEnabled?: boolean;
  alwaysDisabled?: boolean;
}

const ALL_MODALITIES: Modality[] = [
  'ICONS_2D',
  'ASSETS_3D',
  'IMAGES',
  'VIDEO',
  'LORE',
  'MUSIC',
  'VOICES',
  'SFX',
  'OTHER',
];

export async function seedProviders(ctx: SeedContext): Promise<SeededProvidersMap> {
  const defs: ProviderSeedDef[] = [
    {
      name: 'ForgeStudio Demo Engine',
      kind: 'DEMO',
      tier: 'LOCAL',
      roles: ['LLM', 'VISION', 'GENERATOR'],
      modalities: ALL_MODALITIES,
      defaultModel: 'forge-demo-synth-v1',
      models: [
        {
          id: 'forge-demo-compiler-1',
          label: 'Forge Demo Compiler v1',
          modalities: ALL_MODALITIES,
          roles: ['LLM', 'VISION'],
        },
        {
          id: 'forge-demo-synth-v1',
          label: 'Forge Procedural Synthesizer v1',
          modalities: ALL_MODALITIES,
          roles: ['GENERATOR'],
        },
      ],
      settings: { maxConcurrency: 4, costPerRequestUsd: 0, timeoutMs: 60000 },
      defaultForModalities: ALL_MODALITIES,
      alwaysEnabled: true,
    },
    {
      name: 'Anthropic',
      kind: 'ANTHROPIC',
      tier: 'CLOUD_API',
      roles: ['LLM', 'VISION', 'GENERATOR'],
      modalities: ['OTHER'],
      envKey: 'SEED_ANTHROPIC_API_KEY',
      defaultModel: 'claude-sonnet-4-5',
      models: [
        {
          id: 'claude-sonnet-4-5',
          label: 'Claude Sonnet 4.5',
          modalities: ['OTHER'],
          roles: ['LLM', 'VISION', 'GENERATOR'],
        },
        {
          id: 'claude-opus-4-1',
          label: 'Claude Opus 4.1',
          modalities: ['OTHER'],
          roles: ['LLM', 'VISION', 'GENERATOR'],
        },
        {
          id: 'claude-haiku-4-5',
          label: 'Claude Haiku 4.5',
          modalities: ['OTHER'],
          roles: ['LLM', 'VISION', 'GENERATOR'],
        },
      ],
      settings: { maxConcurrency: 4, costPerRequestUsd: 0.015 },
    },
    {
      name: 'OpenAI',
      kind: 'OPENAI',
      tier: 'CLOUD_API',
      roles: ['LLM', 'VISION', 'GENERATOR'],
      modalities: ['ICONS_2D', 'IMAGES', 'VOICES', 'OTHER'],
      envKey: 'SEED_OPENAI_API_KEY',
      defaultModel: 'gpt-image-1',
      models: [
        { id: 'gpt-5', label: 'GPT-5', modalities: ['OTHER'], roles: ['LLM', 'VISION', 'GENERATOR'] },
        {
          id: 'gpt-5-mini',
          label: 'GPT-5 Mini',
          modalities: ['OTHER'],
          roles: ['LLM', 'VISION', 'GENERATOR'],
        },
        {
          id: 'gpt-image-1',
          label: 'GPT Image 1',
          modalities: ['ICONS_2D', 'IMAGES', 'OTHER'],
          roles: ['GENERATOR'],
        },
        {
          id: 'dall-e-3',
          label: 'DALL-E 3',
          modalities: ['ICONS_2D', 'IMAGES'],
          roles: ['GENERATOR'],
        },
        {
          id: 'gpt-4o-mini-tts',
          label: 'GPT-4o Mini TTS',
          modalities: ['VOICES'],
          roles: ['GENERATOR'],
        },
      ],
      settings: { maxConcurrency: 4, costPerRequestUsd: 0.04 },
    },
    {
      name: 'Google Gemini',
      kind: 'GEMINI',
      tier: 'CLOUD_API',
      roles: ['LLM', 'VISION', 'GENERATOR'],
      modalities: ['ICONS_2D', 'IMAGES', 'VOICES', 'OTHER'],
      envKey: 'SEED_GEMINI_API_KEY',
      defaultModel: 'gemini-nano-banana-2.1',
      models: [
        {
          id: 'gemini-3.8-flash',
          label: 'Gemini 3.8 Flash',
          modalities: ['OTHER'],
          roles: ['LLM', 'VISION', 'GENERATOR'],
        },
        {
          id: 'gemini-3.5-flash-lite',
          label: 'Gemini 3.5 Flash-Lite',
          modalities: ['OTHER'],
          roles: ['LLM', 'VISION', 'GENERATOR'],
        },
        {
          id: 'gemini-4-argon',
          label: 'Gemini 4 Argon',
          modalities: ['OTHER'],
          roles: ['LLM', 'VISION', 'GENERATOR'],
        },
        {
          id: 'gemini-nano-banana-2.1',
          label: 'Gemini Nano Banana 2.1 (Image)',
          modalities: ['ICONS_2D', 'IMAGES', 'OTHER'],
          roles: ['GENERATOR'],
        },
        {
          id: 'gemini-3-pro-image',
          label: 'Gemini 3 Pro Image',
          modalities: ['ICONS_2D', 'IMAGES', 'OTHER'],
          roles: ['GENERATOR'],
        },
        {
          id: 'gemini-3.8-flash-tts',
          label: 'Gemini 3.8 Flash TTS',
          modalities: ['VOICES'],
          roles: ['GENERATOR'],
        },
      ],
      settings: { maxConcurrency: 4, costPerRequestUsd: 0.03 },
    },
    {
      name: 'Gemini Web (Guest Mode)',
      kind: 'GOOGLE_WEB',
      tier: 'CLOUD_API',
      roles: ['LLM', 'VISION', 'GENERATOR'],
      modalities: ['ICONS_2D', 'IMAGES', 'LORE', 'OTHER'],
      baseUrl: 'https://gemini.google.com/app',
      defaultModel: 'gemini-web-guest-img:3.5-flash-lite',
      models: GOOGLE_WEB_MODEL_CATALOG.filter((m) => m.authMode === 'gemini_guest').map((m) => ({
        id: m.id,
        label: m.label,
        modalities: [...m.modalities] as Modality[],
        roles: [...m.roles] as ProviderRole[],
        notes: m.notes,
      })),
      settings: {
        webAuthMode: 'gemini_guest',
        browserHeadless: true,
        autoDeleteCreatedChats: false,
        maxConcurrency: 1,
        costPerRequestUsd: 0,
        timeoutMs: 300000,
      },
      alwaysEnabled: true,
    },
    {
      name: 'Gemini Web (Signed In)',
      kind: 'GOOGLE_WEB',
      tier: 'CLOUD_API',
      roles: ['LLM', 'VISION', 'GENERATOR'],
      modalities: ['ICONS_2D', 'IMAGES', 'VIDEO', 'LORE', 'OTHER'],
      baseUrl: 'https://gemini.google.com/app',
      defaultModel: 'gemini-web-img:4.0-argon',
      models: GOOGLE_WEB_MODEL_CATALOG.filter((m) => m.authMode === 'gemini_auth').map((m) => ({
        id: m.id,
        label: m.label,
        modalities: [...m.modalities] as Modality[],
        roles: [...m.roles] as ProviderRole[],
        notes: m.notes,
      })),
      settings: {
        webAuthMode: 'gemini_auth',
        browserHeadless: true,
        autoDeleteCreatedChats: false,
        maxConcurrency: 1,
        costPerRequestUsd: 0,
        timeoutMs: 300000,
      },
      alwaysEnabled: true,
    },
    {
      name: 'Google AI Studio (Signed In)',
      kind: 'GOOGLE_WEB',
      tier: 'CLOUD_API',
      roles: ['LLM', 'VISION', 'GENERATOR'],
      modalities: ['ICONS_2D', 'IMAGES', 'VIDEO', 'LORE', 'VOICES', 'SFX', 'MUSIC', 'OTHER'],
      baseUrl: 'https://aistudio.google.com',
      defaultModel: 'aistudio-img:nano-banana-2.1',
      models: GOOGLE_WEB_MODEL_CATALOG.filter((m) => m.authMode === 'aistudio').map((m) => ({
        id: m.id,
        label: m.label,
        modalities: [...m.modalities] as Modality[],
        roles: [...m.roles] as ProviderRole[],
        notes: m.notes,
      })),
      settings: {
        webAuthMode: 'aistudio',
        browserHeadless: true,
        autoDeleteCreatedChats: false,
        maxConcurrency: 1,
        costPerRequestUsd: 0,
        timeoutMs: 360000,
      },
      alwaysEnabled: true,
    },
    {
      name: 'Fal.ai (Flux)',
      kind: 'FAL',
      tier: 'CLOUD_API',
      roles: ['GENERATOR'],
      modalities: ['ICONS_2D', 'IMAGES', 'OTHER'],
      envKey: 'SEED_FAL_KEY',
      defaultModel: 'fal-ai/flux-pro/v1.1',
      models: [
        {
          id: 'fal-ai/flux-pro/v1.1',
          label: 'Flux Pro v1.1',
          modalities: ['ICONS_2D', 'IMAGES', 'OTHER'],
        },
        { id: 'fal-ai/flux/dev', label: 'Flux Dev', modalities: ['ICONS_2D', 'IMAGES', 'OTHER'] },
      ],
      settings: { maxConcurrency: 4, costPerRequestUsd: 0.04, pollIntervalMs: 1500 },
    },
    {
      name: 'Replicate',
      kind: 'REPLICATE',
      tier: 'CLOUD_API',
      roles: ['GENERATOR'],
      modalities: ['IMAGES', 'MUSIC', 'SFX'],
      envKey: 'SEED_REPLICATE_API_TOKEN',
      defaultModel: 'black-forest-labs/flux-1.1-pro',
      models: [
        {
          id: 'black-forest-labs/flux-1.1-pro',
          label: 'Flux 1.1 Pro',
          modalities: ['IMAGES'],
        },
        { id: 'meta/musicgen', label: 'Meta MusicGen Stereo Large', modalities: ['MUSIC', 'SFX'] },
      ],
      settings: { maxConcurrency: 3, costPerRequestUsd: 0.05, pollIntervalMs: 2000 },
    },
    {
      name: 'Stability AI',
      kind: 'STABILITY',
      tier: 'CLOUD_API',
      roles: ['GENERATOR'],
      modalities: ['IMAGES', 'ICONS_2D', 'MUSIC', 'SFX'],
      envKey: 'SEED_STABILITY_API_KEY',
      defaultModel: 'sd3.5-large',
      models: [
        { id: 'sd3.5-large', label: 'Stable Diffusion 3.5 Large', modalities: ['IMAGES', 'ICONS_2D'] },
        { id: 'ultra', label: 'Stable Image Ultra', modalities: ['IMAGES', 'ICONS_2D'] },
        { id: 'stable-audio-2', label: 'Stable Audio 2.0', modalities: ['MUSIC', 'SFX'] },
      ],
      settings: { maxConcurrency: 3, costPerRequestUsd: 0.065 },
    },
    {
      name: 'Meshy',
      kind: 'MESHY',
      tier: 'CLOUD_API',
      roles: ['GENERATOR'],
      modalities: ['ASSETS_3D'],
      envKey: 'SEED_MESHY_API_KEY',
      defaultModel: 'meshy-5',
      models: [{ id: 'meshy-5', label: 'Meshy-5 PBR 3D', modalities: ['ASSETS_3D'] }],
      settings: { timeoutMs: 900000, pollIntervalMs: 4000, maxConcurrency: 2, costPerRequestUsd: 0.2 },
    },
    {
      name: 'Tripo3D',
      kind: 'TRIPO3D',
      tier: 'CLOUD_API',
      roles: ['GENERATOR'],
      modalities: ['ASSETS_3D'],
      envKey: 'SEED_TRIPO_API_KEY',
      defaultModel: 'default',
      models: [{ id: 'default', label: 'Tripo3D v2.0', modalities: ['ASSETS_3D'] }],
      settings: { timeoutMs: 600000, pollIntervalMs: 3000, maxConcurrency: 2, costPerRequestUsd: 0.15 },
    },
    {
      name: 'Hyper3D Rodin',
      kind: 'RODIN',
      tier: 'CLOUD_API',
      roles: ['GENERATOR'],
      modalities: ['ASSETS_3D'],
      envKey: 'SEED_RODIN_API_KEY',
      defaultModel: 'Regular',
      models: [{ id: 'Regular', label: 'Rodin Gen-1.5 Regular', modalities: ['ASSETS_3D'] }],
      settings: { timeoutMs: 600000, pollIntervalMs: 4000, maxConcurrency: 2, costPerRequestUsd: 0.25 },
    },
    {
      name: 'ElevenLabs',
      kind: 'ELEVENLABS',
      tier: 'CLOUD_API',
      roles: ['GENERATOR'],
      modalities: ['VOICES', 'SFX', 'MUSIC'],
      envKey: 'SEED_ELEVENLABS_API_KEY',
      defaultModel: 'eleven_multilingual_v2',
      models: [
        { id: 'eleven_multilingual_v2', label: 'Eleven Multilingual v2', modalities: ['VOICES'] },
        { id: 'eleven_v3', label: 'Eleven v3 Expressive', modalities: ['VOICES'] },
        { id: 'music_v1', label: 'Eleven Music v1', modalities: ['MUSIC', 'SFX'] },
      ],
      settings: { maxConcurrency: 4, costPerRequestUsd: 0.03 },
    },
    {
      name: 'Cartesia',
      kind: 'CARTESIA',
      tier: 'CLOUD_API',
      roles: ['GENERATOR'],
      modalities: ['VOICES'],
      envKey: 'SEED_CARTESIA_API_KEY',
      defaultModel: 'sonic-2',
      models: [{ id: 'sonic-2', label: 'Cartesia Sonic-2 Low Latency', modalities: ['VOICES'] }],
      settings: { maxConcurrency: 4, costPerRequestUsd: 0.015 },
    },
    {
      name: 'Fish Audio',
      kind: 'FISH_AUDIO',
      tier: 'CLOUD_API',
      roles: ['GENERATOR'],
      modalities: ['VOICES'],
      envKey: 'SEED_FISH_API_KEY',
      defaultModel: 's1',
      models: [{ id: 's1', label: 'Fish Speech S1', modalities: ['VOICES'] }],
      settings: { maxConcurrency: 4, costPerRequestUsd: 0.012 },
    },
    {
      name: 'RunPod · ComfyUI Flux Worker',
      kind: 'RUNPOD_SERVERLESS',
      tier: 'RUNPOD',
      roles: ['GENERATOR'],
      modalities: ['ICONS_2D', 'IMAGES', 'OTHER'],
      envKey: 'SEED_RUNPOD_API_KEY',
      endpointEnvKey: 'SEED_RUNPOD_COMFY_ENDPOINT_ID',
      defaultModel: 'flux1-dev-fp8.safetensors',
      models: [
        {
          id: 'flux1-dev-fp8.safetensors',
          label: 'Flux.1 Dev FP8 (ComfyUI Worker)',
          modalities: ['ICONS_2D', 'IMAGES', 'OTHER'],
        },
      ],
      payloadTemplate: {
        input: {
          workflow: RUNPOD_COMFY_WORKFLOW_INNER,
        },
      },
      outputMapping: {
        assets: [
          {
            path: 'output.images[*].data',
            encoding: 'base64',
            mimeType: 'image/png',
            role: 'PRIMARY',
          },
        ],
        errorPath: 'error',
      },
      settings: {
        costPerSecondUsd: 0.00044,
        pollIntervalMs: 2000,
        maxPollIntervalMs: 15000,
        timeoutMs: 300000,
        maxConcurrency: 3,
      },
    },
    {
      name: 'RunPod · F5-TTS Voice Worker',
      kind: 'RUNPOD_SERVERLESS',
      tier: 'RUNPOD',
      roles: ['GENERATOR'],
      modalities: ['VOICES'],
      envKey: 'SEED_RUNPOD_API_KEY',
      endpointEnvKey: 'SEED_RUNPOD_TTS_ENDPOINT_ID',
      defaultModel: 'f5-tts-v1',
      models: [{ id: 'f5-tts-v1', label: 'F5-TTS Zero-Shot Worker', modalities: ['VOICES'] }],
      payloadTemplate: {
        input: {
          text: '{{enhanced_prompt}}',
          ref_audio_url: '{{params.ref_audio_url}}',
          speed: '{{speed}}',
          seed: '{{seed}}',
          format: 'wav',
        },
      },
      outputMapping: {
        assets: [
          {
            path: 'output.audio_base64',
            encoding: 'base64',
            mimeType: 'audio/wav',
            role: 'PRIMARY',
          },
        ],
      },
      settings: {
        costPerSecondUsd: 0.00031,
        pollIntervalMs: 2000,
        maxPollIntervalMs: 15000,
        timeoutMs: 180000,
        maxConcurrency: 2,
      },
    },
    {
      name: 'Local ComfyUI',
      kind: 'COMFYUI',
      tier: 'LOCAL',
      roles: ['GENERATOR'],
      modalities: ['ICONS_2D', 'IMAGES', 'OTHER'],
      baseUrl: 'http://127.0.0.1:8188',
      defaultModel: 'flux1-dev-fp8.safetensors',
      models: [
        {
          id: 'flux1-dev-fp8.safetensors',
          label: 'Local Flux.1 Dev FP8',
          modalities: ['ICONS_2D', 'IMAGES', 'OTHER'],
        },
      ],
      workflowTemplate: RUNPOD_COMFY_WORKFLOW_INNER,
      settings: { maxConcurrency: 1, timeoutMs: 300000, pollIntervalMs: 1500 },
      alwaysDisabled: true,
    },
    {
      name: 'Local Forge / A1111',
      kind: 'A1111',
      tier: 'LOCAL',
      roles: ['GENERATOR'],
      modalities: ['ICONS_2D', 'IMAGES', 'OTHER'],
      baseUrl: 'http://127.0.0.1:7860',
      defaultModel: 'sdxl_base_1.0',
      models: [
        { id: 'sdxl_base_1.0', label: 'SDXL 1.0 Base', modalities: ['ICONS_2D', 'IMAGES', 'OTHER'] },
      ],
      settings: { maxConcurrency: 1, timeoutMs: 180000, pollIntervalMs: 1000 },
      alwaysDisabled: true,
    },
    {
      name: 'Local Ollama',
      kind: 'OLLAMA',
      tier: 'LOCAL',
      roles: ['LLM', 'VISION'],
      modalities: [],
      baseUrl: 'http://127.0.0.1:11434',
      defaultModel: 'qwen2.5:14b',
      models: [
        { id: 'qwen2.5:14b', label: 'Qwen 2.5 14B Instruct', modalities: [], roles: ['LLM'] },
        { id: 'llama3.1:8b', label: 'Llama 3.1 8B Instruct', modalities: [], roles: ['LLM'] },
        { id: 'llava:13b', label: 'LLaVA 13B Vision', modalities: [], roles: ['LLM', 'VISION'] },
      ],
      settings: { maxConcurrency: 2, timeoutMs: 120000 },
      alwaysDisabled: true,
    },
    {
      name: 'LM Studio',
      kind: 'OPENAI_COMPATIBLE',
      tier: 'LOCAL',
      roles: ['LLM'],
      modalities: [],
      baseUrl: 'http://127.0.0.1:1234',
      defaultModel: 'local-model',
      models: [{ id: 'local-model', label: 'LM Studio Active Model', modalities: [], roles: ['LLM'] }],
      settings: { maxConcurrency: 2, timeoutMs: 120000 },
      alwaysDisabled: true,
    },
    {
      name: 'Kokoro TTS (local)',
      kind: 'OPENAI_COMPATIBLE',
      tier: 'LOCAL',
      roles: ['GENERATOR'],
      modalities: ['VOICES'],
      baseUrl: 'http://127.0.0.1:8880',
      defaultModel: 'kokoro',
      models: [
        {
          id: 'kokoro',
          label: 'Kokoro-82M (af_heart / am_michael)',
          modalities: ['VOICES'],
          notes: 'Voices: af_heart, am_michael',
        },
      ],
      settings: { maxConcurrency: 2, timeoutMs: 60000 },
      alwaysDisabled: true,
    },
    {
      name: 'Local F5-TTS Server',
      kind: 'GENERIC_HTTP',
      tier: 'LOCAL',
      roles: ['GENERATOR'],
      modalities: ['VOICES'],
      baseUrl: 'http://127.0.0.1:7865',
      defaultModel: 'f5-tts-local',
      models: [{ id: 'f5-tts-local', label: 'Local F5-TTS HTTP Server', modalities: ['VOICES'] }],
      payloadTemplate: {
        text: '{{enhanced_prompt}}',
        speed: '{{speed}}',
        seed: '{{seed}}',
      },
      outputMapping: {
        assets: [
          {
            path: 'audio_base64',
            encoding: 'base64',
            mimeType: 'audio/wav',
            role: 'PRIMARY',
          },
        ],
      },
      settings: { path: '/tts', maxConcurrency: 1, timeoutMs: 90000 },
      alwaysDisabled: true,
    },
  ];

  const byName: Record<string, AiProviderConfig> = {};

  for (const def of defs) {
    const rawSecret = def.envKey ? process.env[def.envKey]?.trim() : undefined;
    const rawEndpoint = def.endpointEnvKey ? process.env[def.endpointEnvKey]?.trim() : undefined;

    const hasSecret = Boolean(rawSecret && rawSecret.length > 0);
    const hasEndpoint = Boolean(rawEndpoint && rawEndpoint.length > 0);

    let isEnabled = false;
    if (def.alwaysEnabled) {
      isEnabled = true;
    } else if (def.alwaysDisabled) {
      isEnabled = false;
    } else if (def.endpointEnvKey) {
      isEnabled = hasSecret && hasEndpoint;
    } else {
      isEnabled = hasSecret;
    }

    const encryptedSecret =
      hasSecret && rawSecret ? ctx.cipher.encrypt(rawSecret) : null;
    const secretLast4 = hasSecret && rawSecret ? ctx.cipher.last4(rawSecret) : null;
    const runpodEndpointId =
      def.kind === 'RUNPOD_SERVERLESS'
        ? hasEndpoint && rawEndpoint
          ? rawEndpoint
          : 'replace0endpoint'
        : null;

    const healthState: HealthState =
      def.kind === 'DEMO' ? 'HEALTHY' : isEnabled ? 'HEALTHY' : 'UNKNOWN';

    const created = await ctx.prisma.aiProviderConfig.create({
      data: {
        name: def.name,
        kind: def.kind,
        tier: def.tier,
        roles: def.roles,
        modalities: def.modalities,
        baseUrl: def.baseUrl ?? null,
        encryptedSecret,
        secretLast4,
        runpodEndpointId,
        defaultModel: def.defaultModel ?? null,
        models: def.models as unknown as Prisma.InputJsonValue,
        payloadTemplate: (def.payloadTemplate ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        outputMapping: (def.outputMapping ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        workflowTemplate: (def.workflowTemplate ?? Prisma.JsonNull) as Prisma.InputJsonValue,
        extraHeaders: {},
        settings: def.settings as Prisma.InputJsonValue,
        defaultForModalities: def.defaultForModalities ?? [],
        isEnabled,
        healthState,
        healthLatencyMs: def.kind === 'DEMO' ? 2 : null,
        healthMessage: def.kind === 'DEMO' ? 'Procedural synthesizer ready (offline)' : null,
        healthCheckedAt: def.kind === 'DEMO' ? new Date('2026-10-22T12:00:00Z') : null,
      },
    });

    byName[def.name] = created;
  }

  return {
    byName,
    demo: byName['ForgeStudio Demo Engine']!,
    anthropic: byName['Anthropic']!,
    openai: byName['OpenAI']!,
    gemini: byName['Google Gemini']!,
    geminiWebGuest: byName['Gemini Web (Guest Mode)']!,
    geminiWebAuth: byName['Gemini Web (Signed In)']!,
    aiStudio: byName['Google AI Studio (Signed In)']!,
    fal: byName['Fal.ai (Flux)']!,
    replicate: byName['Replicate']!,
    stability: byName['Stability AI']!,
    meshy: byName['Meshy']!,
    tripo3d: byName['Tripo3D']!,
    rodin: byName['Hyper3D Rodin']!,
    elevenlabs: byName['ElevenLabs']!,
    cartesia: byName['Cartesia']!,
    fishAudio: byName['Fish Audio']!,
    runpodComfy: byName['RunPod · ComfyUI Flux Worker']!,
    runpodTts: byName['RunPod · F5-TTS Voice Worker']!,
    localComfy: byName['Local ComfyUI']!,
    localA1111: byName['Local Forge / A1111']!,
    localOllama: byName['Local Ollama']!,
    lmStudio: byName['LM Studio']!,
    kokoroTts: byName['Kokoro TTS (local)']!,
    localF5Tts: byName['Local F5-TTS Server']!,
  };
}
