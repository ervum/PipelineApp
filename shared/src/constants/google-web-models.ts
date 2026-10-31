import { Modality, ProviderRole } from '../enums';

export type GoogleWebAuthMode = 'gemini_guest' | 'gemini_auth' | 'aistudio';

export type GoogleWebCategory =
  | 'text'
  | 'image'
  | 'video'
  | 'tts'
  | 'audio_live'
  | 'music';

export type GoogleWebThinkingLevel = 'Minimal' | 'Low' | 'Medium' | 'High';

export type GoogleWebOutputFormat = 'Images only' | 'Images & text';

export type GoogleWebVideoTask =
  | 'unspecified'
  | 'text to video'
  | 'image to video'
  | 'reference to video'
  | 'edit video'
  | 'extend video';

export type GoogleWebMediaResolution =
  | 'Default'
  | 'Low'
  | 'Medium'
  | 'High'
  | 'Low (66 tokens / image)'
  | 'Medium (258 tokens / image)';

export const GOOGLE_WEB_LIVE_VOICES = [
  'Zephyr',
  'Puck',
  'Charon',
  'Kore',
  'Fenrir',
  'Leda',
  'Orus',
  'Aoede',
  'Callirhoe',
  'Autonoe',
  'Enceladus',
  'Iapetus',
  'Umbriel',
  'Algieba',
  'Despina',
  'Erinome',
  'Algenib',
  'Rasalgethi',
  'Laomedeia',
  'Achernar',
  'Alnilam',
  'Schedar',
  'Gacrux',
  'Pulcherrima',
  'Achird',
  'Zubenelgenubi',
  'Vindemiatrix',
  'Sadachbia',
  'Sadaltager',
  'Sulafat',
] as const;

export type GoogleWebLiveVoice = (typeof GOOGLE_WEB_LIVE_VOICES)[number];

export const NANO_BANANA_15_ASPECT_RATIOS = [
  'Auto',
  '1:1',
  '9:16',
  '16:9',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
  '4:1',
  '1:4',
  '8:1',
  '1:8',
] as const;

export const NANO_BANANA_11_ASPECT_RATIOS = [
  'Auto',
  '1:1',
  '9:16',
  '16:9',
  '3:4',
  '4:3',
  '3:2',
  '2:3',
  '5:4',
  '4:5',
  '21:9',
] as const;

export const GEMINI_WEB_IMAGE_ASPECT_RATIOS = [
  '1:1',
  '9:16',
  '3:4',
  '4:3',
  '16:9',
] as const;

export const GEMINI_WEB_VIDEO_ASPECT_RATIOS = [
  'Landscape (16:9)',
  'Portrait (9:16)',
] as const;

export const AISTUDIO_VIDEO_ASPECT_RATIOS = ['Auto', '16:9', '9:16'] as const;

export const AISTUDIO_VIDEO_RESOLUTIONS = [
  '360p',
  '720p',
  '1,080p',
  '4K',
] as const;

export const AISTUDIO_VIDEO_TASKS: readonly GoogleWebVideoTask[] = [
  'unspecified',
  'text to video',
  'image to video',
  'reference to video',
  'edit video',
  'extend video',
] as const;

export interface GoogleWebRunSettings {
  outputFormat?: GoogleWebOutputFormat;
  temperature?: number;
  aspectRatio?: string;
  resolution?: string;
  thinkingLevel?: GoogleWebThinkingLevel;
  groundingWithGoogleSearch?: boolean;
  imageSearch?: boolean;
  structuredOutputs?: boolean;
  codeExecution?: boolean;
  functionCalling?: boolean;
  autoFunctionResponse?: boolean;
  urlContext?: boolean;
  stopSequences?: string[];
  outputLength?: number;
  topP?: number;
  videoDurationSec?: number;
  frameRate?: '24FPS';
  videoTask?: GoogleWebVideoTask;
  liveVoice?: GoogleWebLiveVoice;
  mediaResolution?: GoogleWebMediaResolution;
  maxContextSize?: number;
  targetContextSize?: number;
  inputAudioAssetId?: string;
  inputVideoAssetId?: string;
}

export interface GoogleWebModelParameterSpec {
  hasConfiguration: boolean;
  outputFormats?: readonly GoogleWebOutputFormat[];
  temperature?: { min: number; max: number; step: number; default: number };
  aspectRatios?: readonly string[];
  resolutions?: readonly string[];
  thinkingLevels?: readonly GoogleWebThinkingLevel[];
  mediaResolutions?: readonly GoogleWebMediaResolution[];
  supportsGroundingWithGoogleSearch?: boolean;
  supportsImageSearch?: boolean;
  supportsStructuredOutputs?: boolean;
  supportsCodeExecution?: boolean;
  supportsFunctionCalling?: boolean;
  supportsAutoFunctionResponse?: boolean;
  supportsUrlContext?: boolean;
  supportsStopSequence?: boolean;
  outputLength?: { min: number; max: number; default: number };
  topP?: { min: number; max: number; step: number; default: number };
  videoDurationSec?: { min: number; max: number; default: number };
  frameRates?: readonly ('24FPS')[];
  videoTasks?: readonly GoogleWebVideoTask[];
  voices?: readonly GoogleWebLiveVoice[];
  contextSize?: { min: number; max: number; defaultMax: number; defaultTarget: number };
}

export interface GoogleWebModelDefinition {
  id: string;
  label: string;
  authMode: GoogleWebAuthMode;
  category: GoogleWebCategory;
  targetUrl: string;
  pickerLabel: string;
  modalities: Modality[];
  roles: ProviderRole[];
  notes?: string;
  parameters: GoogleWebModelParameterSpec;
}

const AISTUDIO_TEXT_COMMON_MEDIA_RESOLUTIONS: readonly GoogleWebMediaResolution[] = [
  'Default',
  'Low',
  'Medium',
  'High',
];

export const GOOGLE_WEB_MODEL_CATALOG: readonly GoogleWebModelDefinition[] = [
  // ───────────────────────────── A. Language Models ─────────────────────────────
  {
    id: 'gemini-web-guest:3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite (Guest)',
    authMode: 'gemini_guest',
    category: 'text',
    targetUrl: 'https://gemini.google.com/app',
    pickerLabel: '3.5 Flash-Lite',
    modalities: [Modality.LORE, Modality.OTHER],
    roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
    notes: 'No sign-in required; thinking is automatic in Guest Mode',
    parameters: {
      hasConfiguration: false,
    },
  },
  {
    id: 'gemini-web:3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite (Gemini Web)',
    authMode: 'gemini_auth',
    category: 'text',
    targetUrl: 'https://gemini.google.com/app',
    pickerLabel: '3.5 Flash-Lite',
    modalities: [Modality.LORE, Modality.OTHER],
    roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'gemini-web:3.8-flash',
    label: 'Gemini 3.8 Flash (Gemini Web)',
    authMode: 'gemini_auth',
    category: 'text',
    targetUrl: 'https://gemini.google.com/app',
    pickerLabel: '3.8 Flash',
    modalities: [Modality.LORE, Modality.OTHER],
    roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'gemini-web:3.1-pro',
    label: 'Gemini 3.1 Pro (Gemini Web)',
    authMode: 'gemini_auth',
    category: 'text',
    targetUrl: 'https://gemini.google.com/app',
    pickerLabel: '3.1 Pro',
    modalities: [Modality.LORE, Modality.OTHER],
    roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'gemini-web:4.0-argon',
    label: 'Gemini 4.0 Argon (Gemini Web)',
    authMode: 'gemini_auth',
    category: 'text',
    targetUrl: 'https://gemini.google.com/app',
    pickerLabel: '4.0 Argon',
    modalities: [Modality.LORE, Modality.OTHER],
    roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'aistudio:gemini-3.0-flash',
    label: 'Gemini 3.0 Flash (AI Studio)',
    authMode: 'aistudio',
    category: 'text',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.0-flash',
    pickerLabel: 'Gemini 3.0 Flash',
    modalities: [Modality.LORE, Modality.OTHER],
    roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 2, step: 0.05, default: 1 },
      thinkingLevels: ['Minimal', 'Low', 'Medium', 'High'],
      mediaResolutions: AISTUDIO_TEXT_COMMON_MEDIA_RESOLUTIONS,
      supportsStructuredOutputs: true,
      supportsCodeExecution: true,
      supportsFunctionCalling: true,
      supportsGroundingWithGoogleSearch: true,
      supportsUrlContext: true,
      topP: { min: 0, max: 1, step: 0.01, default: 0.95 },
      outputLength: { min: 1, max: 65536, default: 65536 },
      supportsStopSequence: true,
    },
  },
  {
    id: 'aistudio:gemini-3.1-flash-lite',
    label: 'Gemini 3.1 Flash Lite (AI Studio)',
    authMode: 'aistudio',
    category: 'text',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-flash-lite-preview',
    pickerLabel: 'Gemini 3.1 Flash-Lite Preview',
    modalities: [Modality.LORE, Modality.OTHER],
    roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 2, step: 0.05, default: 1 },
      thinkingLevels: ['Minimal', 'Low', 'Medium', 'High'],
      mediaResolutions: AISTUDIO_TEXT_COMMON_MEDIA_RESOLUTIONS,
      supportsStructuredOutputs: true,
      supportsCodeExecution: true,
      supportsFunctionCalling: true,
      supportsGroundingWithGoogleSearch: true,
      supportsUrlContext: true,
      topP: { min: 0, max: 1, step: 0.01, default: 0.95 },
      outputLength: { min: 1, max: 65536, default: 65536 },
      supportsStopSequence: true,
    },
  },
  {
    id: 'aistudio:gemini-3.1-pro',
    label: 'Gemini 3.1 Pro (AI Studio)',
    authMode: 'aistudio',
    category: 'text',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-pro-preview',
    pickerLabel: 'Gemini 3.1 Pro Preview',
    modalities: [Modality.LORE, Modality.OTHER],
    roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 2, step: 0.05, default: 1 },
      thinkingLevels: ['Low', 'Medium', 'High'],
      mediaResolutions: AISTUDIO_TEXT_COMMON_MEDIA_RESOLUTIONS,
      supportsStructuredOutputs: true,
      supportsCodeExecution: true,
      supportsFunctionCalling: true,
      supportsGroundingWithGoogleSearch: true,
      supportsUrlContext: true,
      topP: { min: 0, max: 1, step: 0.01, default: 0.95 },
      outputLength: { min: 1, max: 65536, default: 65536 },
      supportsStopSequence: true,
    },
  },
  {
    id: 'aistudio:gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite (AI Studio)',
    authMode: 'aistudio',
    category: 'text',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.5-flash-lite',
    pickerLabel: 'Gemini 3.5 Flash-Lite',
    modalities: [Modality.LORE, Modality.OTHER],
    roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 2, step: 0.05, default: 1 },
      thinkingLevels: ['Minimal', 'Low', 'Medium', 'High'],
      mediaResolutions: AISTUDIO_TEXT_COMMON_MEDIA_RESOLUTIONS,
      supportsStructuredOutputs: true,
      supportsCodeExecution: true,
      supportsFunctionCalling: true,
      supportsGroundingWithGoogleSearch: true,
      supportsUrlContext: true,
      topP: { min: 0, max: 1, step: 0.01, default: 0.95 },
      outputLength: { min: 1, max: 65536, default: 65536 },
      supportsStopSequence: true,
    },
  },
  {
    id: 'aistudio:gemini-3.8-flash',
    label: 'Gemini 3.8 Flash (AI Studio)',
    authMode: 'aistudio',
    category: 'text',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.8-flash',
    pickerLabel: 'Gemini 3.8 Flash',
    modalities: [Modality.LORE, Modality.OTHER],
    roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 2, step: 0.05, default: 1 },
      thinkingLevels: ['Minimal', 'Low', 'Medium', 'High'],
      mediaResolutions: AISTUDIO_TEXT_COMMON_MEDIA_RESOLUTIONS,
      supportsStructuredOutputs: true,
      supportsCodeExecution: true,
      supportsFunctionCalling: true,
      supportsGroundingWithGoogleSearch: true,
      supportsUrlContext: true,
      topP: { min: 0, max: 1, step: 0.01, default: 0.95 },
      outputLength: { min: 1, max: 65536, default: 65536 },
      supportsStopSequence: true,
    },
  },
  {
    id: 'aistudio:gemini-4.0-argon',
    label: 'Gemini 4.0 Argon (AI Studio)',
    authMode: 'aistudio',
    category: 'text',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-4.0-argon',
    pickerLabel: 'Gemini 4.0 Argon',
    modalities: [Modality.LORE, Modality.OTHER],
    roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 2, step: 0.05, default: 1 },
      thinkingLevels: ['Low', 'High'],
      mediaResolutions: AISTUDIO_TEXT_COMMON_MEDIA_RESOLUTIONS,
      supportsStructuredOutputs: true,
      supportsCodeExecution: true,
      supportsFunctionCalling: true,
      supportsGroundingWithGoogleSearch: true,
      supportsUrlContext: true,
      topP: { min: 0, max: 1, step: 0.01, default: 0.95 },
      outputLength: { min: 1, max: 65536, default: 65536 },
      supportsStopSequence: true,
    },
  },

  // ───────────────────────────── B. Multimodal Image Generators ─────────────────────────────
  {
    id: 'gemini-web-guest-img:3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite (Guest Images)',
    authMode: 'gemini_guest',
    category: 'image',
    targetUrl: 'https://gemini.google.com/images',
    pickerLabel: '3.5 Flash-Lite',
    modalities: [Modality.ICONS_2D, Modality.IMAGES, Modality.OTHER],
    roles: [ProviderRole.GENERATOR],
    notes: 'Guest mode image synthesis via gemini.google.com/images (no configuration options)',
    parameters: {
      hasConfiguration: false,
    },
  },
  {
    id: 'gemini-web-img:3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite (Images)',
    authMode: 'gemini_auth',
    category: 'image',
    targetUrl: 'https://gemini.google.com/images',
    pickerLabel: '3.5 Flash-Lite',
    modalities: [Modality.ICONS_2D, Modality.IMAGES, Modality.OTHER],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      aspectRatios: GEMINI_WEB_IMAGE_ASPECT_RATIOS,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'gemini-web-img:3.8-flash',
    label: 'Gemini 3.8 Flash (Images)',
    authMode: 'gemini_auth',
    category: 'image',
    targetUrl: 'https://gemini.google.com/images',
    pickerLabel: '3.8 Flash',
    modalities: [Modality.ICONS_2D, Modality.IMAGES, Modality.OTHER],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      aspectRatios: GEMINI_WEB_IMAGE_ASPECT_RATIOS,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'gemini-web-img:3.1-pro',
    label: 'Gemini 3.1 Pro (Images)',
    authMode: 'gemini_auth',
    category: 'image',
    targetUrl: 'https://gemini.google.com/images',
    pickerLabel: '3.1 Pro',
    modalities: [Modality.ICONS_2D, Modality.IMAGES, Modality.OTHER],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      aspectRatios: GEMINI_WEB_IMAGE_ASPECT_RATIOS,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'gemini-web-img:4.0-argon',
    label: 'Gemini 4.0 Argon (Images)',
    authMode: 'gemini_auth',
    category: 'image',
    targetUrl: 'https://gemini.google.com/images',
    pickerLabel: '4.0 Argon',
    modalities: [Modality.ICONS_2D, Modality.IMAGES, Modality.OTHER],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      aspectRatios: GEMINI_WEB_IMAGE_ASPECT_RATIOS,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'aistudio-img:nano-banana-2.1',
    label: 'Nano Banana 2.1',
    authMode: 'aistudio',
    category: 'image',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.5-flash-image',
    pickerLabel: 'Nano Banana 2.1',
    modalities: [Modality.ICONS_2D, Modality.IMAGES, Modality.OTHER],
    roles: [ProviderRole.GENERATOR],
    notes: 'AI Studio gemini-3.5-flash-image (1K/2K/4K, 15 aspect ratios)',
    parameters: {
      hasConfiguration: true,
      outputFormats: ['Images only', 'Images & text'],
      temperature: { min: 0, max: 1, step: 0.05, default: 1 },
      aspectRatios: NANO_BANANA_15_ASPECT_RATIOS,
      resolutions: ['1K', '2K', '4K'],
      thinkingLevels: ['Minimal', 'Medium', 'High'],
      supportsGroundingWithGoogleSearch: true,
      supportsImageSearch: true,
      supportsStopSequence: true,
      outputLength: { min: 1, max: 65536, default: 65536 },
    },
  },
  {
    id: 'aistudio-img:nano-banana-2',
    label: 'Nano Banana 2',
    authMode: 'aistudio',
    category: 'image',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-flash-image-preview',
    pickerLabel: 'Nano Banana 2',
    modalities: [Modality.ICONS_2D, Modality.IMAGES, Modality.OTHER],
    roles: [ProviderRole.GENERATOR],
    notes: 'AI Studio gemini-3.1-flash-image-preview (512/1K/2K/4K, 15 aspect ratios, Top P)',
    parameters: {
      hasConfiguration: true,
      outputFormats: ['Images only', 'Images & text'],
      temperature: { min: 0, max: 1, step: 0.05, default: 1 },
      aspectRatios: NANO_BANANA_15_ASPECT_RATIOS,
      resolutions: ['512', '1K', '2K', '4K'],
      thinkingLevels: ['Minimal', 'High'],
      supportsGroundingWithGoogleSearch: true,
      supportsImageSearch: true,
      supportsStopSequence: true,
      outputLength: { min: 1, max: 65536, default: 65536 },
      topP: { min: 0, max: 1, step: 0.01, default: 0.95 },
    },
  },
  {
    id: 'aistudio-img:nano-banana-2-lite',
    label: 'Nano Banana 2 Lite',
    authMode: 'aistudio',
    category: 'image',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-flash-lite-image',
    pickerLabel: 'Nano Banana 2 Lite',
    modalities: [Modality.ICONS_2D, Modality.IMAGES, Modality.OTHER],
    roles: [ProviderRole.GENERATOR],
    notes: 'AI Studio gemini-3.1-flash-lite-image (1K resolution, 15 aspect ratios, Top P)',
    parameters: {
      hasConfiguration: true,
      outputFormats: ['Images only', 'Images & text'],
      temperature: { min: 0, max: 1, step: 0.05, default: 1 },
      aspectRatios: NANO_BANANA_15_ASPECT_RATIOS,
      resolutions: ['1K'],
      thinkingLevels: ['Minimal', 'High'],
      supportsStopSequence: true,
      outputLength: { min: 1, max: 65536, default: 65536 },
      topP: { min: 0, max: 1, step: 0.01, default: 0.95 },
    },
  },
  {
    id: 'aistudio-img:nano-banana-pro',
    label: 'Nano Banana Pro',
    authMode: 'aistudio',
    category: 'image',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3-pro-image-preview',
    pickerLabel: 'Nano Banana Pro',
    modalities: [Modality.ICONS_2D, Modality.IMAGES, Modality.OTHER],
    roles: [ProviderRole.GENERATOR],
    notes: 'AI Studio gemini-3-pro-image-preview (1K/2K/4K, 11 aspect ratios, 32K output)',
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 1, step: 0.05, default: 1 },
      aspectRatios: NANO_BANANA_11_ASPECT_RATIOS,
      resolutions: ['1K', '2K', '4K'],
      supportsGroundingWithGoogleSearch: true,
      supportsStopSequence: true,
      outputLength: { min: 1, max: 32768, default: 32768 },
      topP: { min: 0, max: 1, step: 0.01, default: 0.95 },
    },
  },
  {
    id: 'aistudio-img:nano-banana',
    label: 'Nano Banana',
    authMode: 'aistudio',
    category: 'image',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-2.5-flash-image',
    pickerLabel: 'Nano Banana',
    modalities: [Modality.ICONS_2D, Modality.IMAGES, Modality.OTHER],
    roles: [ProviderRole.GENERATOR],
    notes: 'AI Studio gemini-2.5-flash-image (11 aspect ratios, 32K output)',
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 1, step: 0.05, default: 1 },
      aspectRatios: NANO_BANANA_11_ASPECT_RATIOS,
      supportsStopSequence: true,
      outputLength: { min: 1, max: 32768, default: 32768 },
      topP: { min: 0, max: 1, step: 0.01, default: 0.95 },
    },
  },

  // ───────────────────────────── C. Multimodal Video Generators ─────────────────────────────
  {
    id: 'gemini-web-vid:3.5-flash-lite',
    label: 'Gemini 3.5 Flash Lite (Videos)',
    authMode: 'gemini_auth',
    category: 'video',
    targetUrl: 'https://gemini.google.com/videos',
    pickerLabel: '3.5 Flash-Lite',
    modalities: [Modality.VIDEO],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      aspectRatios: GEMINI_WEB_VIDEO_ASPECT_RATIOS,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'gemini-web-vid:3.8-flash',
    label: 'Gemini 3.8 Flash (Videos)',
    authMode: 'gemini_auth',
    category: 'video',
    targetUrl: 'https://gemini.google.com/videos',
    pickerLabel: '3.8 Flash',
    modalities: [Modality.VIDEO],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      aspectRatios: GEMINI_WEB_VIDEO_ASPECT_RATIOS,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'gemini-web-vid:3.1-pro',
    label: 'Gemini 3.1 Pro (Videos)',
    authMode: 'gemini_auth',
    category: 'video',
    targetUrl: 'https://gemini.google.com/videos',
    pickerLabel: '3.1 Pro',
    modalities: [Modality.VIDEO],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      aspectRatios: GEMINI_WEB_VIDEO_ASPECT_RATIOS,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'gemini-web-vid:4.0-argon',
    label: 'Gemini 4.0 Argon (Videos)',
    authMode: 'gemini_auth',
    category: 'video',
    targetUrl: 'https://gemini.google.com/videos',
    pickerLabel: '4.0 Argon',
    modalities: [Modality.VIDEO],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      aspectRatios: GEMINI_WEB_VIDEO_ASPECT_RATIOS,
      thinkingLevels: ['Low', 'Medium', 'High'],
    },
  },
  {
    id: 'aistudio-vid:gemini-omni-1.1-flash',
    label: 'Gemini Omni 1.1 Flash',
    authMode: 'aistudio',
    category: 'video',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-omni-1.1-flash',
    pickerLabel: 'Gemini Omni 1.1 Flash',
    modalities: [Modality.VIDEO],
    roles: [ProviderRole.GENERATOR],
    notes: 'AI Studio multimodal video generation & editing (3-10s, 360p-4K, 24FPS)',
    parameters: {
      hasConfiguration: true,
      aspectRatios: AISTUDIO_VIDEO_ASPECT_RATIOS,
      videoDurationSec: { min: 3, max: 10, default: 5 },
      resolutions: AISTUDIO_VIDEO_RESOLUTIONS,
      frameRates: ['24FPS'],
      thinkingLevels: ['Low', 'High'],
      supportsStopSequence: true,
      outputLength: { min: 1, max: 65536, default: 65536 },
      videoTasks: AISTUDIO_VIDEO_TASKS,
    },
  },

  // ───────────────────────────── D. Audio (TTS), Audio-to-Audio (Live) & Music ─────────────────────────────
  {
    id: 'aistudio-tts:gemini-2.5-flash-tts',
    label: 'Gemini 2.5 Flash Preview TTS',
    authMode: 'aistudio',
    category: 'tts',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-2.5-flash-preview-tts',
    pickerLabel: 'Gemini 2.5 Flash Preview TTS',
    modalities: [Modality.VOICES],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 2, step: 0.05, default: 1 },
    },
  },
  {
    id: 'aistudio-tts:gemini-2.5-pro-tts',
    label: 'Gemini 2.5 Pro Preview TTS',
    authMode: 'aistudio',
    category: 'tts',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-2.5-pro-preview-tts',
    pickerLabel: 'Gemini 2.5 Pro Preview TTS',
    modalities: [Modality.VOICES],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 2, step: 0.05, default: 1 },
    },
  },
  {
    id: 'aistudio-tts:gemini-3.1-flash-tts',
    label: 'Gemini 3.1 Flash TTS Preview',
    authMode: 'aistudio',
    category: 'tts',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.1-flash-tts-preview',
    pickerLabel: 'Gemini 3.1 Flash TTS Preview',
    modalities: [Modality.VOICES],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 2, step: 0.05, default: 1 },
    },
  },
  {
    id: 'aistudio-tts:gemini-3.8-flash-lite-tts',
    label: 'Gemini 3.8 Flash Lite TTS',
    authMode: 'aistudio',
    category: 'tts',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.8-flash-lite-tts',
    pickerLabel: 'Gemini 3.8 Flash Lite TTS',
    modalities: [Modality.VOICES],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 2, step: 0.05, default: 1 },
    },
  },
  {
    id: 'aistudio-tts:gemini-3.8-flash-tts',
    label: 'Gemini 3.8 Flash TTS',
    authMode: 'aistudio',
    category: 'tts',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=gemini-3.8-flash-tts',
    pickerLabel: 'Gemini 3.8 Flash TTS',
    modalities: [Modality.VOICES],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      temperature: { min: 0, max: 2, step: 0.05, default: 1 },
    },
  },
  {
    id: 'aistudio-live:gemini-3.1-flash-live',
    label: 'Gemini 3.1 Flash Live Preview',
    authMode: 'aistudio',
    category: 'audio_live',
    targetUrl: 'https://aistudio.google.com/live?model=gemini-3.1-flash-live-preview',
    pickerLabel: 'Gemini 3.1 Flash Live Preview',
    modalities: [Modality.VOICES, Modality.SFX],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      voices: GOOGLE_WEB_LIVE_VOICES,
      mediaResolutions: ['Low (66 tokens / image)', 'Medium (258 tokens / image)'],
      thinkingLevels: ['Minimal', 'Low', 'Medium', 'High'],
      contextSize: { min: 16000, max: 131072, defaultMax: 131072, defaultTarget: 65536 },
      supportsFunctionCalling: true,
      supportsAutoFunctionResponse: true,
      supportsGroundingWithGoogleSearch: true,
    },
  },
  {
    id: 'aistudio-live:gemini-3.8-live',
    label: 'Gemini 3.8 Live',
    authMode: 'aistudio',
    category: 'audio_live',
    targetUrl: 'https://aistudio.google.com/live?model=gemini-3.8-live',
    pickerLabel: 'Gemini 3.8 Live',
    modalities: [Modality.VOICES, Modality.SFX],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      voices: GOOGLE_WEB_LIVE_VOICES,
      mediaResolutions: ['Low (66 tokens / image)', 'Medium (258 tokens / image)'],
      thinkingLevels: ['Minimal', 'Low', 'Medium', 'High'],
      contextSize: { min: 16000, max: 131072, defaultMax: 131072, defaultTarget: 65536 },
      supportsFunctionCalling: true,
      supportsAutoFunctionResponse: true,
      supportsGroundingWithGoogleSearch: true,
    },
  },
  {
    id: 'aistudio-live:gemini-3.8-live-thinking',
    label: 'Gemini 3.8 Live Extended Thinking',
    authMode: 'aistudio',
    category: 'audio_live',
    targetUrl: 'https://aistudio.google.com/live?model=gemini-3.8-live-thinking',
    pickerLabel: 'Gemini 3.8 Live Extended Thinking',
    modalities: [Modality.VOICES, Modality.SFX],
    roles: [ProviderRole.GENERATOR],
    parameters: {
      hasConfiguration: true,
      voices: GOOGLE_WEB_LIVE_VOICES,
      mediaResolutions: ['Low (66 tokens / image)', 'Medium (258 tokens / image)'],
      thinkingLevels: ['Minimal', 'Low', 'Medium', 'High'],
      contextSize: { min: 16000, max: 131072, defaultMax: 131072, defaultTarget: 65536 },
      supportsFunctionCalling: true,
      supportsAutoFunctionResponse: true,
      supportsGroundingWithGoogleSearch: true,
    },
  },
  {
    id: 'aistudio-music:lyria-3-clip',
    label: 'Lyria 3 Clip',
    authMode: 'aistudio',
    category: 'music',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=lyria-3-clip',
    pickerLabel: 'Lyria 3 Clip',
    modalities: [Modality.MUSIC],
    roles: [ProviderRole.GENERATOR],
    notes: 'AI Studio Lyria 3 Clip music generation (no extra configuration options)',
    parameters: {
      hasConfiguration: false,
    },
  },
  {
    id: 'aistudio-music:lyria-3-pro',
    label: 'Lyria 3 Pro Preview',
    authMode: 'aistudio',
    category: 'music',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=lyria-3-pro-preview',
    pickerLabel: 'Lyria 3 Pro Preview',
    modalities: [Modality.MUSIC],
    roles: [ProviderRole.GENERATOR],
    notes: 'AI Studio Lyria 3 Pro Preview music generation (no extra configuration options)',
    parameters: {
      hasConfiguration: false,
    },
  },
  {
    id: 'aistudio-music:lyria-3.5',
    label: 'Lyria 3.5',
    authMode: 'aistudio',
    category: 'music',
    targetUrl: 'https://aistudio.google.com/prompts/new_chat?model=lyria-3.5',
    pickerLabel: 'Lyria 3.5',
    modalities: [Modality.MUSIC],
    roles: [ProviderRole.GENERATOR],
    notes: 'AI Studio Lyria 3.5 music generation (no extra configuration options)',
    parameters: {
      hasConfiguration: false,
    },
  },
];

export function findGoogleWebModel(modelId: string | null | undefined): GoogleWebModelDefinition | null {
  if (!modelId) return null;
  return GOOGLE_WEB_MODEL_CATALOG.find((m) => m.id === modelId) ?? null;
}

export function getGoogleWebModelsForModality(
  modality: Modality,
  authMode?: GoogleWebAuthMode,
): GoogleWebModelDefinition[] {
  return GOOGLE_WEB_MODEL_CATALOG.filter(
    (m) =>
      m.modalities.includes(modality) &&
      (!authMode || m.authMode === authMode),
  );
}

export function defaultGoogleWebRunSettingsForModel(
  modelId: string | null | undefined,
): GoogleWebRunSettings {
  const def = findGoogleWebModel(modelId);
  if (!def || !def.parameters.hasConfiguration) {
    return {};
  }
  const p = def.parameters;
  const settings: GoogleWebRunSettings = {};
  if (p.outputFormats?.length) {
    settings.outputFormat = p.outputFormats[0];
  }
  if (p.temperature) {
    settings.temperature = p.temperature.default;
  }
  if (p.aspectRatios?.length) {
    settings.aspectRatio = p.aspectRatios[0];
  }
  if (p.resolutions?.length) {
    settings.resolution = p.resolutions.includes('1K')
      ? '1K'
      : p.resolutions.includes('1,080p')
        ? '1,080p'
        : p.resolutions[0];
  }
  if (p.thinkingLevels?.length) {
    settings.thinkingLevel = p.thinkingLevels.includes('Low')
      ? 'Low'
      : p.thinkingLevels[0];
  }
  if (p.mediaResolutions?.length) {
    settings.mediaResolution = p.mediaResolutions[0];
  }
  if (p.supportsGroundingWithGoogleSearch) {
    settings.groundingWithGoogleSearch = false;
  }
  if (p.supportsImageSearch) {
    settings.imageSearch = false;
  }
  if (p.supportsStructuredOutputs) {
    settings.structuredOutputs = false;
  }
  if (p.supportsCodeExecution) {
    settings.codeExecution = false;
  }
  if (p.supportsFunctionCalling) {
    settings.functionCalling = false;
  }
  if (p.supportsAutoFunctionResponse) {
    settings.autoFunctionResponse = false;
  }
  if (p.supportsUrlContext) {
    settings.urlContext = false;
  }
  if (p.supportsStopSequence) {
    settings.stopSequences = [];
  }
  if (p.outputLength) {
    settings.outputLength = p.outputLength.default;
  }
  if (p.topP) {
    settings.topP = p.topP.default;
  }
  if (p.videoDurationSec) {
    settings.videoDurationSec = p.videoDurationSec.default;
  }
  if (p.frameRates?.length) {
    settings.frameRate = '24FPS';
  }
  if (p.videoTasks?.length) {
    settings.videoTask = 'unspecified';
  }
  if (p.voices?.length) {
    settings.liveVoice = 'Puck';
  }
  if (p.contextSize) {
    settings.maxContextSize = p.contextSize.defaultMax;
    settings.targetContextSize = p.contextSize.defaultTarget;
  }
  return settings;
}
