import { z } from 'zod';
import { GOOGLE_WEB_LIVE_VOICES } from '../constants/google-web-models';
import { Modality } from '../enums';
import { HexColorSchema, IdSchema, SeedSchema } from './common.schema';

const seed = SeedSchema.nullable().default(null);

export const GoogleWebRunSettingsSchema = z
  .object({
    outputFormat: z.enum(['Images only', 'Images & text']).optional(),
    temperature: z.number().min(0).max(2).optional(),
    aspectRatio: z.string().optional(),
    resolution: z.string().optional(),
    thinkingLevel: z.enum(['Minimal', 'Low', 'Medium', 'High']).optional(),
    groundingWithGoogleSearch: z.boolean().optional(),
    imageSearch: z.boolean().optional(),
    structuredOutputs: z.boolean().optional(),
    codeExecution: z.boolean().optional(),
    functionCalling: z.boolean().optional(),
    autoFunctionResponse: z.boolean().optional(),
    urlContext: z.boolean().optional(),
    stopSequences: z.array(z.string()).optional(),
    outputLength: z.number().int().min(1).max(65536).optional(),
    topP: z.number().min(0).max(1).optional(),
    videoDurationSec: z.number().min(3).max(10).optional(),
    frameRate: z.literal('24FPS').optional(),
    videoTask: z
      .enum([
        'unspecified',
        'text to video',
        'image to video',
        'reference to video',
        'edit video',
        'extend video',
      ])
      .optional(),
    liveVoice: z.enum(GOOGLE_WEB_LIVE_VOICES).optional(),
    mediaResolution: z
      .enum([
        'Default',
        'Low',
        'Medium',
        'High',
        'Low (66 tokens / image)',
        'Medium (258 tokens / image)',
      ])
      .optional(),
    maxContextSize: z.number().int().min(16000).max(131072).optional(),
    targetContextSize: z.number().int().min(16000).max(131072).optional(),
    inputAudioAssetId: z.string().optional(),
    inputVideoAssetId: z.string().optional(),
  })
  .partial();

export const Icons2DParamsSchema = z.object({
  modality: z.literal('ICONS_2D'),
  iconCategory: z.enum(['ITEM', 'SKILL', 'RANK_EMBLEM', 'UI_BUTTON']).default('ITEM'),
  frameShape: z
    .enum(['NONE', 'CIRCLE', 'ROUNDED_SQUARE', 'HEXAGON', 'SHIELD', 'DIAMOND'])
    .default('NONE'),
  removeBackground: z.boolean().default(true),
  solidBackgroundHex: HexColorSchema.nullable().default(null),
  outputSize: z.union([z.literal(512), z.literal(1024)]).default(1024),
  batchCount: z.number().int().min(1).max(4).default(1),
  googleWebRunSettings: GoogleWebRunSettingsSchema.optional(),
  seed,
});

export const Assets3DParamsSchema = z
  .object({
    modality: z.literal('ASSETS_3D'),
    subMode: z.enum(['TEXT_TO_3D', 'IMAGE_TO_3D']).default('TEXT_TO_3D'),
    referenceStorageKey: z.string().nullable().default(null),
    assetCategory: z.enum(['PROP', 'WEAPON', 'ENVIRONMENT', 'CHARACTER_BASE']).default('PROP'),
    polycountTier: z.enum(['LOW_POLY', 'MID_POLY', 'HIGH_RES']).default('LOW_POLY'),
    textureResolution: z
      .union([z.literal(1024), z.literal(2048), z.literal(4096)])
      .default(2048),
    outputFormat: z.enum(['glb', 'fbx', 'obj']).default('glb'),
    pose: z.enum(['NONE', 'T_POSE', 'A_POSE']).default('NONE'),
    enablePbr: z.boolean().default(true),
    topology: z.enum(['TRIANGLE', 'QUAD']).default('TRIANGLE'),
    seed,
  })
  .superRefine((v, ctx) => {
    if (v.subMode === 'IMAGE_TO_3D' && !v.referenceStorageKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceStorageKey'],
        message: 'Image-to-3D requires a reference image',
      });
    }
  });

export const POLYCOUNT_TARGETS = {
  LOW_POLY: 5_000,
  MID_POLY: 30_000,
  HIGH_RES: 150_000,
} as const;

export const ImagesParamsSchema = z.object({
  modality: z.literal('IMAGES'),
  imageCategory: z
    .enum(['THUMBNAIL', 'CONCEPT_ART', 'PBR_TEXTURE', 'BACKGROUND', 'SPLASH_ART'])
    .default('CONCEPT_ART'),
  aspectPreset: z
    .enum(['SQUARE_1_1', 'THUMB_16_9', 'PORTRAIT_9_16', 'SEAMLESS_TILE'])
    .default('SQUARE_1_1'),
  styleWeight: z.number().min(0).max(1).default(0.7),
  referenceStorageKey: z.string().nullable().default(null),
  referenceMode: z
    .enum(['NONE', 'IMG2IMG', 'CONTROLNET_CANNY', 'CONTROLNET_DEPTH', 'STYLE_REFERENCE'])
    .default('NONE'),
  referenceStrength: z.number().min(0).max(1).default(0.55),
  batchCount: z.number().int().min(1).max(4).default(1),
  googleWebRunSettings: GoogleWebRunSettingsSchema.optional(),
  seed,
});

export const ASPECT_DIMENSIONS = {
  SQUARE_1_1: { width: 1024, height: 1024, ratio: '1:1' },
  THUMB_16_9: { width: 1536, height: 864, ratio: '16:9' },
  PORTRAIT_9_16: { width: 864, height: 1536, ratio: '9:16' },
  SEAMLESS_TILE: { width: 1024, height: 1024, ratio: '1:1' },
} as const;

export const VIDEO_ASPECT_DIMENSIONS = {
  '16:9': { width: 1280, height: 720, ratio: '16:9' },
  '9:16': { width: 720, height: 1280, ratio: '9:16' },
  '1:1': { width: 1024, height: 1024, ratio: '1:1' },
  '21:9': { width: 1344, height: 576, ratio: '21:9' },
} as const;

export const VideoParamsSchema = z
  .object({
    modality: z.literal('VIDEO'),
    subMode: z.enum(['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO']).default('TEXT_TO_VIDEO'),
    videoCategory: z
      .enum([
        'CUTSCENE',
        'VFX_LOOP',
        'CHARACTER_TURNTABLE',
        'ENVIRONMENT_PAN',
        'TRAILER_SHOT',
        'UI_ANIMATION',
      ])
      .default('CUTSCENE'),
    durationSec: z.number().min(2).max(16).default(5),
    fps: z.union([z.literal(24), z.literal(30), z.literal(60)]).default(24),
    aspectRatio: z.enum(['16:9', '9:16', '1:1', '21:9']).default('16:9'),
    resolution: z.enum(['720p', '1080p']).default('1080p'),
    cameraMotion: z
      .enum([
        'STATIC',
        'PAN_LEFT',
        'PAN_RIGHT',
        'TILT_UP',
        'TILT_DOWN',
        'ZOOM_IN',
        'ZOOM_OUT',
        'ORBIT',
        'DOLLY_TRACK',
      ])
      .default('STATIC'),
    motionIntensity: z.number().min(0).max(1).default(0.5),
    loopable: z.boolean().default(false),
    includeAudio: z.boolean().default(false),
    memoryStrategy: z
      .enum(['AUTO', 'RAM_FALLBACK_32GB', 'LOW_VRAM_TILED', 'VRAM_ONLY'])
      .default('RAM_FALLBACK_32GB'),
    referenceStorageKey: z.string().nullable().default(null),
    lastFrameStorageKey: z.string().nullable().default(null),
    googleWebRunSettings: GoogleWebRunSettingsSchema.optional(),
    seed,
  })
  .superRefine((v, ctx) => {
    if (v.subMode === 'IMAGE_TO_VIDEO' && !v.referenceStorageKey) {
      ctx.addIssue({
        code: 'custom',
        path: ['referenceStorageKey'],
        message: 'Image-to-Video requires a starting frame reference image',
      });
    }
  });

export const LoreParamsSchema = z.object({
  modality: z.literal('LORE'),
  lengthForm: z.enum(['SHORT_FORM', 'MEDIUM_FORM', 'LONG_FORM']).default('SHORT_FORM'),
  loreCategory: z
    .enum([
      'ITEM_DESCRIPTION',
      'SKILL_TOOLTIP',
      'CHARACTER_BACKSTORY',
      'FACTION_HISTORY',
      'WORLD_MYTHOLOGY',
      'LOCATION_CODEX',
      'BESTIARY_ENTRY',
      'IN_WORLD_DOCUMENT',
      'DIALOGUE_SCENE',
    ])
    .default('ITEM_DESCRIPTION'),
  tone: z
    .enum([
      'IN_WORLD_DIEGETIC',
      'ENCYCLOPEDIC_CODEX',
      'POETIC_MYTHIC',
      'GRITTY_NOIR',
      'LIGHTHEARTED_COZY',
      'CLINICAL_SCI_FI',
    ])
    .default('IN_WORLD_DIEGETIC'),
  perspective: z
    .enum([
      'THIRD_PERSON_OMNISCIENT',
      'FIRST_PERSON_CHRONICLER',
      'SECOND_PERSON_PLAYER',
      'EPIGRAPH_FRAGMENT',
    ])
    .default('THIRD_PERSON_OMNISCIENT'),
  targetWordCount: z.number().int().min(20).max(3000).default(100),
  includeSections: z.boolean().default(false),
  outputFormat: z.enum(['MARKDOWN', 'PLAIN_TEXT']).default('MARKDOWN'),
  batchCount: z.number().int().min(1).max(3).default(1),
  googleWebRunSettings: GoogleWebRunSettingsSchema.optional(),
  seed,
});

export const MusicParamsSchema = z.object({
  modality: z.literal('MUSIC'),
  trackType: z.enum(['BGM_LOOP', 'COMBAT', 'AMBIENT', 'STINGER', 'MENU']).default('BGM_LOOP'),
  durationSec: z.number().min(5).max(300).default(60),
  bpm: z.number().int().min(40).max(220).nullable().default(null),
  keySignature: z.string().max(24).nullable().default(null),
  seamlessLoop: z.boolean().default(true),
  instrumentalOnly: z.boolean().default(true),
  generateStems: z.boolean().default(false),
  outputFormat: z.enum(['wav', 'mp3']).default('wav'),
  googleWebRunSettings: GoogleWebRunSettingsSchema.optional(),
  seed,
});

export const VoicesParamsSchema = z.object({
  modality: z.literal('VOICES'),
  transcript: z.string().max(5000).default(''),
  voiceProfileId: IdSchema.nullable().default(null),
  lineType: z.enum(['DIALOGUE', 'BARK', 'NARRATION']).default('DIALOGUE'),
  emotionTags: z
    .array(
      z.enum([
        'NEUTRAL',
        'ANGRY',
        'JOYFUL',
        'SAD',
        'FEARFUL',
        'WHISPER',
        'SHOUT',
        'SARCASTIC',
        'HEROIC',
        'MENACING',
        'TIRED',
        'PLAYFUL',
      ]),
    )
    .max(4)
    .default(['NEUTRAL']),
  speed: z.number().min(0.7).max(1.3).default(1),
  stability: z.number().min(0).max(1).default(0.5),
  similarityBoost: z.number().min(0).max(1).default(0.75),
  style: z.number().min(0).max(1).default(0.3),
  outputFormat: z.enum(['wav', 'mp3']).default('wav'),
  batchCount: z.number().int().min(1).max(3).default(1),
  googleWebRunSettings: GoogleWebRunSettingsSchema.optional(),
  seed,
});

export const SfxParamsSchema = z.object({
  modality: z.literal('SFX'),
  sfxCategory: z
    .enum([
      'WEAPON_HIT',
      'UI_CLICK',
      'FOOTSTEP',
      'MAGIC',
      'AMBIENT_FOLEY',
      'EXPLOSION',
      'CREATURE',
      'IMPACT',
    ])
    .default('WEAPON_HIT'),
  durationSec: z.number().min(0.5).max(22).default(1.5),
  loopable: z.boolean().default(false),
  promptInfluence: z.number().min(0).max(1).default(0.45),
  variationCount: z.number().int().min(1).max(8).default(4),
  outputFormat: z.enum(['wav', 'mp3', 'ogg']).default('wav'),
  googleWebRunSettings: GoogleWebRunSettingsSchema.optional(),
  seed,
});

export const OtherParamsSchema = z.object({
  modality: z.literal('OTHER'),
  subMode: z.enum(['SPRITESHEET', 'VFX_TEXTURE', 'SHADER_CODE', 'LORE_JSON']),
  spritesheet: z
    .object({
      frameCount: z.number().int().min(2).max(64).default(16),
      columns: z.number().int().min(1).max(8).default(4),
      frameSize: z
        .union([z.literal(64), z.literal(128), z.literal(256), z.literal(512)])
        .default(256),
      animationType: z
        .enum(['IDLE', 'ATTACK', 'CAST', 'EXPLOSION', 'LOOP_FX', 'WALK'])
        .default('LOOP_FX'),
      fps: z.number().int().min(4).max(60).default(12),
    })
    .default({}),
  vfx: z
    .object({
      textureType: z.enum(['PARTICLE', 'MASK', 'NOISE', 'TRAIL', 'FLIPBOOK']).default('PARTICLE'),
      grayscale: z.boolean().default(true),
      tileable: z.boolean().default(false),
      resolution: z.union([z.literal(256), z.literal(512), z.literal(1024)]).default(512),
    })
    .default({}),
  shader: z
    .object({
      language: z.enum(['LUAU', 'GDSCRIPT', 'GODOT_SHADER', 'HLSL', 'GLSL']).default('LUAU'),
      targetEngine: z.enum(['ROBLOX', 'GODOT', 'UNITY', 'GENERIC']).default('ROBLOX'),
    })
    .default({}),
  loreJson: z
    .object({
      schemaKind: z
        .enum(['ITEM_TABLE', 'DIALOGUE_TREE', 'QUEST', 'NPC_ROSTER'])
        .default('ITEM_TABLE'),
      entryCount: z.number().int().min(1).max(50).default(8),
      customSchema: z.string().max(8000).nullable().default(null),
    })
    .default({}),
  googleWebRunSettings: GoogleWebRunSettingsSchema.optional(),
  seed,
});

export const ModalityParamsSchema = z.discriminatedUnion('modality', [
  Icons2DParamsSchema,
  Assets3DParamsSchema.innerType(),
  ImagesParamsSchema,
  VideoParamsSchema.innerType(),
  LoreParamsSchema,
  MusicParamsSchema,
  VoicesParamsSchema,
  SfxParamsSchema,
  OtherParamsSchema,
]);

export type Icons2DParams = z.infer<typeof Icons2DParamsSchema>;
export type Assets3DParams = z.infer<typeof Assets3DParamsSchema>;
export type ImagesParams = z.infer<typeof ImagesParamsSchema>;
export type VideoParams = z.infer<typeof VideoParamsSchema>;
export type LoreParams = z.infer<typeof LoreParamsSchema>;
export type MusicParams = z.infer<typeof MusicParamsSchema>;
export type VoicesParams = z.infer<typeof VoicesParamsSchema>;
export type SfxParams = z.infer<typeof SfxParamsSchema>;
export type OtherParams = z.infer<typeof OtherParamsSchema>;

export type ModalityParams = z.infer<typeof ModalityParamsSchema>;
export type ParamsFor<M extends Modality> = Extract<ModalityParams, { modality: M }>;

export const defaultParamsFor = <M extends Modality>(m: M): ParamsFor<M> =>
  ModalityParamsSchema.parse({
    modality: m,
    ...(m === 'OTHER' ? { subMode: 'SPRITESHEET' } : {}),
  }) as ParamsFor<M>;
