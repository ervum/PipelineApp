import { Injectable, inject } from '@angular/core';
import {
  ExecutionMode,
  Modality,
  ModalityParams,
  ModalityParamsSchema,
  defaultParamsFor,
} from '@forge/shared';
import { StudioStateService } from '../../../core/state/studio-state.service';

export interface WorkspaceDraftState {
  rawPrompt: string;
  pinnedFileIds: string[];
  params: ModalityParams;
  providerId: string | null;
  providerModel: string | null;
  middlemanProfileId: string | null;
  skipMiddleman: boolean;
  executionMode: ExecutionMode;
  advancedOverrides: Record<string, string | number | boolean>;
}

const STORAGE_PREFIX = 'forge.workspaceDraft.';

@Injectable({ providedIn: 'root' })
export class WorkspaceDraftService {
  private readonly studio = inject(StudioStateService);
  private readonly memory = new Map<string, WorkspaceDraftState>();

  private keyFor(modality: Modality, projectId?: string | null): string {
    const pid = projectId ?? this.studio.activeProjectId() ?? 'default';
    return `${pid}:${modality}`;
  }

  getDraft(modality: Modality, projectId?: string | null): WorkspaceDraftState | null {
    const key = this.keyFor(modality, projectId);
    const cached = this.memory.get(key);
    if (cached) return cached;

    try {
      const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${key}`);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<WorkspaceDraftState>;
      const validParams = ModalityParamsSchema.safeParse(parsed.params);
      const restored: WorkspaceDraftState = {
        rawPrompt: typeof parsed.rawPrompt === 'string' ? parsed.rawPrompt : '',
        pinnedFileIds: Array.isArray(parsed.pinnedFileIds) ? parsed.pinnedFileIds : [],
        params:
          validParams.success && validParams.data.modality === modality
            ? validParams.data
            : defaultParamsFor(modality),
        providerId: typeof parsed.providerId === 'string' ? parsed.providerId : null,
        providerModel:
          typeof parsed.providerModel === 'string' ? parsed.providerModel : null,
        middlemanProfileId:
          typeof parsed.middlemanProfileId === 'string'
            ? parsed.middlemanProfileId
            : null,
        skipMiddleman: Boolean(parsed.skipMiddleman),
        executionMode:
          parsed.executionMode === 'INTERCEPT' ? 'INTERCEPT' : 'AUTO_FIRE',
        advancedOverrides:
          parsed.advancedOverrides && typeof parsed.advancedOverrides === 'object'
            ? parsed.advancedOverrides
            : {},
      };
      this.memory.set(key, restored);
      return restored;
    } catch {
      return null;
    }
  }

  paramsFor(modality: Modality, projectId?: string | null): ModalityParams | null {
    return this.getDraft(modality, projectId)?.params ?? null;
  }

  saveDraft(
    modality: Modality,
    patch: Partial<WorkspaceDraftState>,
    projectId?: string | null,
  ): void {
    const key = this.keyFor(modality, projectId);
    const existing = this.getDraft(modality, projectId) ?? {
      rawPrompt: '',
      pinnedFileIds: [],
      params: defaultParamsFor(modality),
      providerId: null,
      providerModel: null,
      middlemanProfileId: null,
      skipMiddleman: false,
      executionMode: 'AUTO_FIRE' as ExecutionMode,
      advancedOverrides: {},
    };
    const next: WorkspaceDraftState = { ...existing, ...patch };
    this.memory.set(key, next);
    try {
      sessionStorage.setItem(`${STORAGE_PREFIX}${key}`, JSON.stringify(next));
    } catch {
      // sessionStorage quota or SSR safe ignore
    }
  }
}
