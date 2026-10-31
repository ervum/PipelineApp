export const ExecutionMode = {
  AUTO_FIRE: 'AUTO_FIRE',
  INTERCEPT: 'INTERCEPT',
} as const;
export type ExecutionMode = (typeof ExecutionMode)[keyof typeof ExecutionMode];
export const EXECUTION_MODES: readonly ExecutionMode[] = Object.values(ExecutionMode);

export const ExecutionTier = {
  CLOUD_API: 'CLOUD_API',
  RUNPOD: 'RUNPOD',
  LOCAL: 'LOCAL',
} as const;
export type ExecutionTier = (typeof ExecutionTier)[keyof typeof ExecutionTier];
export const EXECUTION_TIERS: readonly ExecutionTier[] = Object.values(ExecutionTier);

export const EXECUTION_TIER_LABEL: Record<ExecutionTier, string> = {
  CLOUD_API: 'Cloud API',
  RUNPOD: 'RunPod GPU',
  LOCAL: 'Local',
};
