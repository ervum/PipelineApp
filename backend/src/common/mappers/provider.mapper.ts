import {
  ExecutionTier,
  HealthState,
  MODALITIES,
  Modality,
  ModelOption,
  OutputMapping,
  ProviderConfigModel,
  ProviderKind,
  ProviderRole,
  ProviderSettings,
  ProviderSettingsSchema,
} from '@forge/shared';
import { AiProviderConfig } from '@prisma/client';

/**
 * Maps an AiProviderConfig row to its API read model.
 * Invariant (§4.5): NEVER exposes encryptedSecret; only hasSecret + secretLast4.
 */
export function toProviderConfigModel(row: AiProviderConfig): ProviderConfigModel {
  const parsedSettings = ProviderSettingsSchema.safeParse(
    typeof row.settings === 'object' && row.settings !== null ? row.settings : {},
  );
  const settings: ProviderSettings = parsedSettings.success ? parsedSettings.data : {};

  const models: ModelOption[] = Array.isArray(row.models)
    ? (row.models as unknown as ModelOption[])
    : [];

  const extraHeaders: Record<string, string> =
    typeof row.extraHeaders === 'object' && row.extraHeaders !== null && !Array.isArray(row.extraHeaders)
      ? (row.extraHeaders as Record<string, string>)
      : {};

  const modalities: Modality[] =
    row.kind === ProviderKind.DEMO
      ? [...MODALITIES]
      : (row.modalities as Modality[]);

  return {
    id: row.id,
    name: row.name,
    kind: row.kind as ProviderKind,
    tier: row.tier as ExecutionTier,
    roles: row.roles as ProviderRole[],
    modalities,
    baseUrl: row.baseUrl,
    hasSecret: Boolean(row.encryptedSecret && row.encryptedSecret.length > 0),
    secretLast4: row.secretLast4 ?? null,
    runpodEndpointId: row.runpodEndpointId,
    defaultModel: row.defaultModel,
    models,
    payloadTemplate:
      typeof row.payloadTemplate === 'object' &&
      row.payloadTemplate !== null &&
      !Array.isArray(row.payloadTemplate)
        ? (row.payloadTemplate as Record<string, unknown>)
        : null,
    outputMapping:
      typeof row.outputMapping === 'object' && row.outputMapping !== null
        ? (row.outputMapping as unknown as OutputMapping)
        : null,
    workflowTemplate:
      typeof row.workflowTemplate === 'object' &&
      row.workflowTemplate !== null &&
      !Array.isArray(row.workflowTemplate)
        ? (row.workflowTemplate as Record<string, unknown>)
        : null,
    extraHeaders,
    settings,
    defaultForModalities: row.defaultForModalities as Modality[],
    isEnabled: row.isEnabled,
    health: {
      state: row.healthState as HealthState,
      latencyMs: row.healthLatencyMs,
      message: row.healthMessage,
      checkedAt: row.healthCheckedAt ? row.healthCheckedAt.toISOString() : null,
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
