import { GenerationSubMode, Modality } from '../enums';

export interface ModalityMeta {
  modality: Modality;
  label: string;
  route: string;
  icon: string;
  accentToken: string;
  description: string;
  outputKinds: Array<'image' | 'model' | 'audio' | 'text' | 'video'>;
  acceptsReference: boolean;
  subModes: GenerationSubMode[];
}

export const MODALITY_META: Record<Modality, ModalityMeta> = {
  ICONS_2D: {
    modality: 'ICONS_2D',
    label: '2D Icons',
    route: 'icons',
    icon: 'icon-badge',
    accentToken: 'violet',
    description: 'Item icons, skill badges, rank emblems, UI buttons',
    outputKinds: ['image'],
    acceptsReference: true,
    subModes: ['STANDARD'],
  },
  ASSETS_3D: {
    modality: 'ASSETS_3D',
    label: '3D Assets',
    route: '3d',
    icon: 'icon-cube',
    accentToken: 'cyan',
    description: 'Props, weapons, environment meshes, character bases',
    outputKinds: ['model', 'image'],
    acceptsReference: true,
    subModes: ['TEXT_TO_3D', 'IMAGE_TO_3D'],
  },
  IMAGES: {
    modality: 'IMAGES',
    label: 'Images',
    route: 'images',
    icon: 'icon-image',
    accentToken: 'violet',
    description: 'Thumbnails, concept art, PBR textures, backgrounds, splash art',
    outputKinds: ['image'],
    acceptsReference: true,
    subModes: ['STANDARD'],
  },
  VIDEO: {
    modality: 'VIDEO',
    label: 'Video',
    route: 'video',
    icon: 'icon-video',
    accentToken: 'cyan',
    description: 'Cinematic cutscenes, VFX loops, character turntables, environment pans',
    outputKinds: ['video', 'image'],
    acceptsReference: true,
    subModes: ['TEXT_TO_VIDEO', 'IMAGE_TO_VIDEO'],
  },
  LORE: {
    modality: 'LORE',
    label: 'Lore & Narrative',
    route: 'lore',
    icon: 'icon-book',
    accentToken: 'amber',
    description: 'Short-form item tooltips & flavor text to long-form character backstories & world chronicles',
    outputKinds: ['text'],
    acceptsReference: false,
    subModes: ['STANDARD'],
  },
  MUSIC: {
    modality: 'MUSIC',
    label: 'Music',
    route: 'music',
    icon: 'icon-music',
    accentToken: 'emerald',
    description: 'Loopable BGM, combat tracks, ambience, stems',
    outputKinds: ['audio'],
    acceptsReference: false,
    subModes: ['STANDARD'],
  },
  VOICES: {
    modality: 'VOICES',
    label: 'Voices',
    route: 'voices',
    icon: 'icon-mic',
    accentToken: 'amber',
    description: 'Character dialogue, voice design, NPC barks',
    outputKinds: ['audio'],
    acceptsReference: false,
    subModes: ['STANDARD'],
  },
  SFX: {
    modality: 'SFX',
    label: 'Sound Effects',
    route: 'sfx',
    icon: 'icon-wave',
    accentToken: 'cyan',
    description: 'Hits, UI clicks, footsteps, magic foley',
    outputKinds: ['audio'],
    acceptsReference: false,
    subModes: ['STANDARD'],
  },
  OTHER: {
    modality: 'OTHER',
    label: 'Other Assets',
    route: 'other',
    icon: 'icon-layers',
    accentToken: 'violet',
    description: 'Spritesheets, VFX textures, shader/Luau snippets, lore JSON',
    outputKinds: ['image', 'text'],
    acceptsReference: true,
    subModes: ['SPRITESHEET', 'VFX_TEXTURE', 'SHADER_CODE', 'LORE_JSON'],
  },
};
