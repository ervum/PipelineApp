import { ExecutionTier, Modality, ProviderKind } from '../enums';
import { CompiledPrompt } from '../schemas/middleman.schema';

export interface MiddlemanProfileModel {
  id: string;
  name: string;
  providerConfigId: string;
  providerName: string;
  providerKind: ProviderKind;
  tier: ExecutionTier;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  maxContextTokens: number;
  supportsVision: boolean;
  attachReferenceImages: boolean;
  maxReferenceImages: number;
  jsonMode: boolean;
  isDefault: boolean;
  isVisionDefault: boolean;
}

export interface MiddlemanTemplateModel {
  id: string;
  projectId: string | null;
  modality: Modality;
  name: string;
  systemTemplate: string;
  defaultNegativePrompt: string;
  hardConstraints: string;
  version: number;
  isActive: boolean;
  updatedAt: string;
}

export interface ContextFileRef {
  fileId: string;
  fileName: string;
  folderPath: string;
  reason: 'PINNED' | 'ALWAYS_INCLUDE' | 'SCOPE';
  tokens: number;
  truncated: boolean;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  model: string;
}

export interface CompilePreviewResult {
  compiled: CompiledPrompt;
  systemPrompt: string;
  userMessage: string;
  contextFiles: ContextFileRef[];
  droppedFiles: ContextFileRef[];
  usage: LlmUsage;
}
