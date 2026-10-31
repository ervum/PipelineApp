import { ContextScope, MODALITY_META, Modality, VaultFileKind } from '@forge/shared';

export function iconForVaultKind(kind: VaultFileKind): string {
  switch (kind) {
    case 'MARKDOWN':
      return 'file-md';
    case 'JSON':
      return 'file-json';
    case 'TEXT':
      return 'file-text';
    case 'IMAGE':
      return 'file-image';
    case 'AUDIO':
      return 'file-audio';
    case 'MODEL_3D':
      return 'file-3d';
    case 'OTHER':
      return 'file-text';
  }
}

export const iconForKind = iconForVaultKind;

export function iconForModality(modality: Modality): string {
  return MODALITY_META[modality].icon.replace(/^icon-/, '');
}

export function accentForScope(scope: ContextScope): 'violet' | 'cyan' | 'emerald' | 'amber' {
  if (scope === 'ALWAYS_INCLUDE') return 'violet';
  const token = MODALITY_META[scope].accentToken;
  if (token === 'cyan' || token === 'emerald' || token === 'amber') return token;
  return 'violet';
}
