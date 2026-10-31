import { ExecutionTier, HealthState, Modality, ProviderKind, ProviderRole } from '../enums';
import { ModelOption, OutputMapping, ProviderSettings } from '../schemas/provider.schema';

export interface ProviderConfigModel {
  id: string;
  name: string;
  kind: ProviderKind;
  tier: ExecutionTier;
  roles: ProviderRole[];
  modalities: Modality[];
  baseUrl: string | null;
  hasSecret: boolean;
  secretLast4: string | null;
  runpodEndpointId: string | null;
  defaultModel: string | null;
  models: ModelOption[];
  payloadTemplate: Record<string, unknown> | null;
  outputMapping: OutputMapping | null;
  workflowTemplate: Record<string, unknown> | null;
  extraHeaders: Record<string, string>;
  settings: ProviderSettings;
  defaultForModalities: Modality[];
  isEnabled: boolean;
  health: {
    state: HealthState;
    latencyMs: number | null;
    message: string | null;
    checkedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
}

export interface ProviderCatalogEntry {
  kind: ProviderKind;
  label: string;
  tier: ExecutionTier;
  roles: ProviderRole[];
  modalities: Modality[];
  requiresSecret: boolean;
  requiresBaseUrl: boolean;
  defaultBaseUrl: string | null;
  secretLabel: string;
  docsUrl: string;
  suggestedModels: ModelOption[];
  editorFields: Array<
    | 'baseUrl'
    | 'secret'
    | 'runpodEndpointId'
    | 'payloadTemplate'
    | 'outputMapping'
    | 'workflowTemplate'
    | 'extraHeaders'
  >;
}
