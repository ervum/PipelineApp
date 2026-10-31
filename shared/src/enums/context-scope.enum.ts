import { Modality } from './modality.enum';

export const ContextScope = {
  ALWAYS_INCLUDE: 'ALWAYS_INCLUDE',
  ...Modality,
} as const;

export type ContextScope = (typeof ContextScope)[keyof typeof ContextScope];
export const CONTEXT_SCOPES: readonly ContextScope[] = Object.values(ContextScope);

/** Product-vocabulary labels shown in the UI and stored in DB via @map. */
export const CONTEXT_SCOPE_LABEL: Record<ContextScope, string> = {
  ALWAYS_INCLUDE: 'ALWAYS_INCLUDE',
  ICONS_2D: '2D_ICONS',
  ASSETS_3D: '3D_ASSETS',
  IMAGES: 'IMAGES',
  VIDEO: 'VIDEO',
  LORE: 'LORE',
  MUSIC: 'MUSIC',
  VOICES: 'VOICES',
  SFX: 'SFX',
  OTHER: 'OTHER',
};

export const modalityToScope = (m: Modality): ContextScope => m;
