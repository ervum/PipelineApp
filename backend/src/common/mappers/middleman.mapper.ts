import {
  ExecutionTier,
  MiddlemanProfileModel,
  MiddlemanTemplateModel,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { MiddlemanProfile, MiddlemanTemplate } from '@prisma/client';

export type MiddlemanProfileWithProvider = MiddlemanProfile & {
  providerConfig: {
    id: string;
    name: string;
    kind: string;
    tier: string;
  };
};

export function toMiddlemanProfileModel(row: MiddlemanProfileWithProvider): MiddlemanProfileModel {
  return {
    id: row.id,
    name: row.name,
    providerConfigId: row.providerConfigId,
    providerName: row.providerConfig.name,
    providerKind: row.providerConfig.kind as ProviderKind,
    tier: row.providerConfig.tier as ExecutionTier,
    model: row.model,
    temperature: row.temperature,
    maxOutputTokens: row.maxOutputTokens,
    maxContextTokens: row.maxContextTokens,
    supportsVision: row.supportsVision,
    attachReferenceImages: row.attachReferenceImages,
    maxReferenceImages: row.maxReferenceImages,
    jsonMode: row.jsonMode,
    isDefault: row.isDefault,
    isVisionDefault: row.isVisionDefault,
  };
}

export function toMiddlemanTemplateModel(row: MiddlemanTemplate): MiddlemanTemplateModel {
  return {
    id: row.id,
    projectId: row.projectId,
    modality: row.modality as Modality,
    name: row.name,
    systemTemplate: row.systemTemplate,
    defaultNegativePrompt: row.defaultNegativePrompt,
    hardConstraints: row.hardConstraints,
    version: row.version,
    isActive: row.isActive,
    updatedAt: row.updatedAt.toISOString(),
  };
}
