import { GenerationSubMode, Modality, ProviderKind } from '../enums';

export interface ParamSpec {
  key: string;
  label: string;
  type: 'number' | 'integer' | 'boolean' | 'enum' | 'string';
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  default: string | number | boolean | null;
  description: string;
  advanced: boolean;
}

export interface AdapterDescriptor {
  adapterId: string;
  providerKind: ProviderKind;
  modality: Modality;
  subModes: GenerationSubMode[];
  supportsNegativePrompt: boolean;
  supportsSeed: boolean;
  supportsReferenceImage: boolean;
  supportsBatch: boolean;
  maxPromptChars: number;
  paramSpecs: ParamSpec[];
}
