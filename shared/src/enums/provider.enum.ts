export const ProviderRole = {
  LLM: 'LLM',
  VISION: 'VISION',
  GENERATOR: 'GENERATOR',
} as const;
export type ProviderRole = (typeof ProviderRole)[keyof typeof ProviderRole];
export const PROVIDER_ROLES: readonly ProviderRole[] = Object.values(ProviderRole);

export const ProviderKind = {
  ANTHROPIC: 'ANTHROPIC',
  OPENAI: 'OPENAI',
  GEMINI: 'GEMINI',
  GOOGLE_WEB: 'GOOGLE_WEB',
  FAL: 'FAL',
  REPLICATE: 'REPLICATE',
  STABILITY: 'STABILITY',
  MESHY: 'MESHY',
  TRIPO3D: 'TRIPO3D',
  RODIN: 'RODIN',
  ELEVENLABS: 'ELEVENLABS',
  CARTESIA: 'CARTESIA',
  FISH_AUDIO: 'FISH_AUDIO',
  RUNPOD_SERVERLESS: 'RUNPOD_SERVERLESS',
  COMFYUI: 'COMFYUI',
  A1111: 'A1111',
  OLLAMA: 'OLLAMA',
  OPENAI_COMPATIBLE: 'OPENAI_COMPATIBLE',
  GENERIC_HTTP: 'GENERIC_HTTP',
  DEMO: 'DEMO',
} as const;
export type ProviderKind = (typeof ProviderKind)[keyof typeof ProviderKind];
export const PROVIDER_KINDS: readonly ProviderKind[] = Object.values(ProviderKind);

export const HealthState = {
  UNKNOWN: 'UNKNOWN',
  HEALTHY: 'HEALTHY',
  DEGRADED: 'DEGRADED',
  UNREACHABLE: 'UNREACHABLE',
  UNAUTHORIZED: 'UNAUTHORIZED',
} as const;
export type HealthState = (typeof HealthState)[keyof typeof HealthState];
export const HEALTH_STATES: readonly HealthState[] = Object.values(HealthState);
