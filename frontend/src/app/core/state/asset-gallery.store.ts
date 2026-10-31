import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  ApprovalStatus,
  AssetFileModel,
  AssetModel,
  ContextScope,
  ExecutionMode,
  ExecutionTier,
  JobModel,
  Modality,
  VaultFileModel,
} from '@forge/shared';
import { AssetsApi } from '../api/assets.api';
import { triggerDownload } from '../utils/download';
import { StudioStateService } from './studio-state.service';
import { ToastService } from './toast.service';
import { VaultStateService } from './vault-state.service';

export interface AssetGalleryFilters {
  modality: Modality | null;
  approval: ApprovalStatus | null;
  favorite: boolean;
  tier: ExecutionTier | null;
  q: string;
  sort: 'newest' | 'oldest' | 'cost' | 'duration';
}

@Injectable({ providedIn: 'root' })
export class AssetGalleryStore {
  private readonly api = inject(AssetsApi);
  private readonly studio = inject(StudioStateService);
  private readonly vault = inject(VaultStateService);
  private readonly toast = inject(ToastService);

  readonly items = signal<AssetModel[]>([]);
  readonly filters = signal<AssetGalleryFilters>({
    modality: null,
    approval: null,
    favorite: false,
    tier: null,
    q: '',
    sort: 'newest',
  });
  readonly nextCursor = signal<string | null>(null);
  readonly loading = signal<boolean>(false);
  readonly selectedAssetId = signal<string | null>(null);
  readonly compareAssetId = signal<string | null>(null);

  readonly selected = computed(
    () => this.items().find((a) => a.id === this.selectedAssetId()) ?? null,
  );
  readonly compare = computed(
    () => this.items().find((a) => a.id === this.compareAssetId()) ?? null,
  );

  readonly visibleItems = computed(() => {
    const f = this.filters();
    const q = f.q.trim().toLowerCase();
    return this.items().filter((a) => {
      if (f.modality && a.modality !== f.modality) return false;
      if (f.approval && a.approval !== f.approval) return false;
      if (f.favorite && !a.isFavorite) return false;
      if (f.tier && a.tier !== f.tier) return false;
      if (
        q &&
        !a.title.toLowerCase().includes(q) &&
        !a.rawPrompt.toLowerCase().includes(q) &&
        !a.tags.some((t) => t.toLowerCase().includes(q))
      ) {
        return false;
      }
      return true;
    });
  });

  readonly totalCost = computed(() =>
    this.visibleItems().reduce((sum, a) => sum + (a.costUsd ?? 0), 0),
  );

  constructor() {
    effect((onCleanup) => {
      const pid = this.studio.activeProjectId();
      const f = this.filters();
      if (!pid) {
        untracked(() => {
          this.items.set([]);
          this.nextCursor.set(null);
          this.selectedAssetId.set(null);
        });
        return;
      }
      const timer = setTimeout(() => {
        void this.reload(pid, f);
      }, 200);
      onCleanup(() => clearTimeout(timer));
    });
  }

  setModalityFilter(modality: Modality | null): void {
    this.filters.update((cur) =>
      cur.modality === modality ? cur : { ...cur, modality },
    );
  }

  patchFilters(patch: Partial<AssetGalleryFilters>): void {
    this.filters.update((cur) => ({ ...cur, ...patch }));
  }

  private async reload(projectId: string, f: AssetGalleryFilters): Promise<void> {
    this.loading.set(true);
    try {
      const page = await this.api.list({
        projectId,
        modality: f.modality ?? undefined,
        approval: f.approval ?? undefined,
        favorite: f.favorite ? true : undefined,
        tier: f.tier ?? undefined,
        q: f.q.trim() || undefined,
        sort: f.sort,
        limit: 40,
      });
      this.items.set(page.items);
      this.nextCursor.set(page.nextCursor);
      if (
        !this.selectedAssetId() ||
        !page.items.some((a) => a.id === this.selectedAssetId())
      ) {
        this.selectedAssetId.set(page.items[0]?.id ?? null);
      }
    } catch {
      // handled by error interceptor
    } finally {
      this.loading.set(false);
    }
  }

  async loadMore(): Promise<void> {
    const pid = this.studio.activeProjectId();
    const cursor = this.nextCursor();
    if (!pid || !cursor || this.loading()) return;
    this.loading.set(true);
    try {
      const f = this.filters();
      const page = await this.api.list({
        projectId: pid,
        modality: f.modality ?? undefined,
        approval: f.approval ?? undefined,
        favorite: f.favorite ? true : undefined,
        tier: f.tier ?? undefined,
        q: f.q.trim() || undefined,
        sort: f.sort,
        limit: 40,
        cursor,
      });
      this.items.update((l) => [...l, ...page.items]);
      this.nextCursor.set(page.nextCursor);
    } finally {
      this.loading.set(false);
    }
  }

  prepend(assets: AssetModel[]): void {
    if (assets.length === 0) return;
    this.items.update((cur) => {
      const existingIds = new Set(assets.map((a) => a.id));
      return [...assets, ...cur.filter((a) => !existingIds.has(a.id))];
    });
    if (assets[0]) {
      this.selectedAssetId.set(assets[0].id);
    }
    void this.studio.refreshStats();
  }

  async toggleFavorite(id: string): Promise<void> {
    const target = this.items().find((a) => a.id === id);
    if (!target) return;
    const nextVal = !target.isFavorite;
    this.items.update((l) =>
      l.map((a) => (a.id === id ? { ...a, isFavorite: nextVal } : a)),
    );
    try {
      const updated = await this.api.update(id, { isFavorite: nextVal });
      this.items.update((l) => l.map((a) => (a.id === id ? updated : a)));
    } catch {
      this.items.update((l) =>
        l.map((a) => (a.id === id ? { ...a, isFavorite: !nextVal } : a)),
      );
    }
  }

  async setApproval(id: string, approval: ApprovalStatus): Promise<void> {
    const updated = await this.api.update(id, { approval });
    this.items.update((l) => l.map((a) => (a.id === id ? updated : a)));
  }

  async rename(id: string, title: string): Promise<void> {
    const updated = await this.api.update(id, { title });
    this.items.update((l) => l.map((a) => (a.id === id ? updated : a)));
  }

  async tag(id: string, tags: string[]): Promise<void> {
    const updated = await this.api.update(id, { tags });
    this.items.update((l) => l.map((a) => (a.id === id ? updated : a)));
  }

  async updateNotes(id: string, notes: string): Promise<void> {
    const updated = await this.api.update(id, { notes });
    this.items.update((l) => l.map((a) => (a.id === id ? updated : a)));
  }

  async delete(id: string): Promise<void> {
    await this.api.delete(id);
    this.items.update((l) => l.filter((a) => a.id !== id));
    if (this.selectedAssetId() === id) {
      this.selectedAssetId.set(this.items()[0]?.id ?? null);
    }
    void this.studio.refreshStats();
  }

  async saveToVault(
    id: string,
    folderId: string,
    scopes: ContextScope[],
    runVision = true,
  ): Promise<VaultFileModel> {
    const file = await this.api.saveToVault(id, {
      folderId,
      scopes,
      runVision,
      fileRole: 'PRIMARY',
    });
    this.items.update((l) =>
      l.map((a) => (a.id === id ? { ...a, savedToVaultFileId: file.id } : a)),
    );
    const pid = this.studio.activeProjectId();
    if (pid) {
      void this.vault.loadProject(pid);
    }
    this.toast.success(`Saved to Project Vault as ${file.name}`);
    return file;
  }

  variation(id: string, executionMode: ExecutionMode): Promise<JobModel> {
    return this.api.variation(id, executionMode);
  }

  download(file: AssetFileModel): void {
    triggerDownload(file.downloadUrl, file.fileName);
  }
}
