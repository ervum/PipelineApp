export const Modality = {
  ICONS_2D: 'ICONS_2D',
  ASSETS_3D: 'ASSETS_3D',
  IMAGES: 'IMAGES',
  VIDEO: 'VIDEO',
  LORE: 'LORE',
  MUSIC: 'MUSIC',
  VOICES: 'VOICES',
  SFX: 'SFX',
  OTHER: 'OTHER',
} as const;

export type Modality = (typeof Modality)[keyof typeof Modality];
export const MODALITIES: readonly Modality[] = Object.values(Modality);
