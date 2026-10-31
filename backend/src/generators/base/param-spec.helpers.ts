import {
  GenerationSubMode,
  Modality,
  ParamSpec,
} from '@forge/shared';
import { defaultParamSpecsForModality } from '../../providers/providers.service';

export function numSpec(opts: {
  key: string;
  label: string;
  min: number;
  max: number;
  step: number;
  default: number;
  description: string;
  advanced?: boolean;
}): ParamSpec {
  return {
    key: opts.key,
    label: opts.label,
    type: 'number',
    min: opts.min,
    max: opts.max,
    step: opts.step,
    default: opts.default,
    description: opts.description,
    advanced: opts.advanced ?? false,
  };
}

export function intSpec(opts: {
  key: string;
  label: string;
  min: number;
  max: number;
  step?: number;
  default: number;
  description: string;
  advanced?: boolean;
}): ParamSpec {
  return {
    key: opts.key,
    label: opts.label,
    type: 'integer',
    min: opts.min,
    max: opts.max,
    step: opts.step ?? 1,
    default: opts.default,
    description: opts.description,
    advanced: opts.advanced ?? false,
  };
}

export function enumSpec(opts: {
  key: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  default: string;
  description: string;
  advanced?: boolean;
}): ParamSpec {
  return {
    key: opts.key,
    label: opts.label,
    type: 'enum',
    options: opts.options,
    default: opts.default,
    description: opts.description,
    advanced: opts.advanced ?? false,
  };
}

export function boolSpec(opts: {
  key: string;
  label: string;
  default: boolean;
  description: string;
  advanced?: boolean;
}): ParamSpec {
  return {
    key: opts.key,
    label: opts.label,
    type: 'boolean',
    default: opts.default,
    description: opts.description,
    advanced: opts.advanced ?? false,
  };
}

export function stringSpec(opts: {
  key: string;
  label: string;
  default: string;
  description: string;
  advanced?: boolean;
}): ParamSpec {
  return {
    key: opts.key,
    label: opts.label,
    type: 'string',
    default: opts.default,
    description: opts.description,
    advanced: opts.advanced ?? false,
  };
}

export function standardParamSpecs(
  modality: Modality,
  subMode: GenerationSubMode = GenerationSubMode.STANDARD,
): ParamSpec[] {
  return defaultParamSpecsForModality(modality, subMode);
}
