import {
  ApprovalStatus,
  AssetFileRole,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ProviderKind,
} from '../enums';

export interface AssetFileModel {
  id: string;
  role: AssetFileRole;
  url: string;
  downloadUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  format: string;
}

export interface VoiceAlignment {
  words: Array<{ word: string; startMs: number; endMs: number }>;
  source?: 'PROVIDER' | 'ESTIMATED';
}

export type AssetMetadata =
  | {
      modality: 'ICONS_2D';
      width: number;
      height: number;
      hasAlpha: boolean;
      frameShape: string;
      iconCategory: string;
      paletteScore?: number;
      dominantHex?: string[];
    }
  | {
      modality: 'ASSETS_3D';
      format: string;
      triangleCount: number | null;
      vertexCount: number | null;
      textureResolution: number;
      hasPbr: boolean;
      boundingBox: [number, number, number] | null;
    }
  | {
      modality: 'IMAGES';
      width: number;
      height: number;
      aspectPreset: string;
      tileable: boolean;
      tileSeamScore?: number;
      paletteScore?: number;
      dominantHex?: string[];
    }
  | {
      modality: 'VIDEO';
      width: number;
      height: number;
      durationMs: number;
      fps: number;
      aspectRatio: string;
      videoCategory: string;
      cameraMotion: string;
      loopable: boolean;
      hasAudio: boolean;
      memoryStrategy: string;
    }
  | {
      modality: 'LORE';
      lengthForm: 'SHORT_FORM' | 'MEDIUM_FORM' | 'LONG_FORM';
      loreCategory: string;
      tone: string;
      perspective: string;
      wordCount: number;
      charCount: number;
      readingTimeSec: number;
      outputFormat: 'MARKDOWN' | 'PLAIN_TEXT';
      excerpt: string;
    }
  | {
      modality: 'MUSIC';
      durationMs: number;
      bpm: number | null;
      keySignature: string | null;
      loop: boolean;
      sampleRate: number;
      stems: string[];
    }
  | {
      modality: 'VOICES';
      durationMs: number;
      voiceProfileId: string | null;
      transcript: string;
      alignment: VoiceAlignment | null;
      sampleRate: number;
    }
  | {
      modality: 'SFX';
      durationMs: number;
      loopable: boolean;
      variationIndex: number;
      sampleRate: number;
    }
  | {
      modality: 'OTHER';
      subMode: GenerationSubMode;
      frameCount?: number;
      columns?: number;
      frameSize?: number;
      fps?: number;
      language?: string;
      schemaKind?: string;
      lineCount?: number;
      tileSeamScore?: number;
    };

export interface AssetModel {
  id: string;
  projectId: string;
  jobId: string | null;
  modality: Modality;
  subMode: GenerationSubMode;
  title: string;
  assetGroupId: string;
  version: number;
  batchIndex: number;
  parentAssetId: string | null;
  rawPrompt: string;
  enhancedPrompt: string;
  negativePrompt: string;
  approval: ApprovalStatus;
  isFavorite: boolean;
  tags: string[];
  notes: string;
  metadata: AssetMetadata;
  providerKind: ProviderKind;
  providerName: string | null;
  providerModel: string | null;
  tier: ExecutionTier;
  costUsd: number | null;
  executionMs: number | null;
  seed: number | null;
  files: AssetFileModel[];
  primaryUrl: string;
  thumbnailUrl: string | null;
  savedToVaultFileId: string | null;
  createdAt: string;
}
