import { HttpEventType } from '@angular/common/http';
import {
  Injectable,
  computed,
  effect,
  inject,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import {
  CONTEXT_SCOPES,
  ContextScope,
  CreateTextFileDto,
  Modality,
  UpsertVoiceProfileDto,
  VaultFileDetailModel,
  VaultFileModel,
  VaultFolderModel,
  VoiceProfileModel,
} from '@forge/shared';
import { VaultApi } from '../api/vault.api';
import { VoiceProfilesApi } from '../api/voice-profiles.api';
import { SocketService } from '../realtime/socket.service';
import { StudioStateService } from './studio-state.service';
import { ToastService } from './toast.service';

export interface UploadTask {
  id: string;
  name: string;
  progress: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

function flattenTree(root: VaultFolderModel | null): Map<string, VaultFolderModel> {
  const map = new Map<string, VaultFolderModel>();
  if (!root) return map;
  const visit = (node: VaultFolderModel): void => {
    map.set(node.id, node);
    for (const child of node.children ?? []) {
      visit(child);
    }
  };
  visit(root);
  return map;
}

function pathToRoot(
  index: Map<string, VaultFolderModel>,
  folderId: string | null,
): VaultFolderModel[] {
  if (!folderId) return [];
  const trail: VaultFolderModel[] = [];
  let cur = index.get(folderId) ?? null;
  let guard = 0;
  while (cur && guard++ < 64) {
    trail.unshift(cur);
    cur = cur.parentId ? (index.get(cur.parentId) ?? null) : null;
  }
  return trail;
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const copy = [...list];
  copy[idx] = item;
  return copy;
}

function groupByScopes(files: VaultFileModel[]): Record<ContextScope, VaultFileModel[]> {
  const result = {} as Record<ContextScope, VaultFileModel[]>;
  for (const scope of CONTEXT_SCOPES) {
    result[scope] = [];
  }
  for (const file of files) {
    for (const scope of file.scopes) {
      result[scope]?.push(file);
    }
  }
  return result;
}

@Injectable({ providedIn: 'root' })
export class VaultStateService {
  private readonly api = inject(VaultApi);
  private readonly voiceApi = inject(VoiceProfilesApi);
  private readonly studio = inject(StudioStateService);
  private readonly socket = inject(SocketService);
  private readonly toast = inject(ToastService);

  readonly tree = signal<VaultFolderModel | null>(null);
  readonly files = signal<VaultFileModel[]>([]);
  readonly voiceProfiles = signal<VoiceProfileModel[]>([]);
  readonly selectedFolderId = signal<string | null>(null);
  readonly selectedFileId = signal<string | null>(null);
  readonly openFile = signal<VaultFileDetailModel | null>(null);
  readonly draftContent = linkedSignal(() => this.openFile()?.contentText ?? '');
  readonly searchQuery = signal('');
  readonly scopeFilter = signal<ContextScope | null>(null);
  readonly viewMode = signal<'list' | 'grid'>('list');
  readonly uploads = signal<UploadTask[]>([]);
  readonly saving = signal(false);

  readonly isDirty = computed(
    () => this.openFile() !== null && this.draftContent() !== (this.openFile()!.contentText ?? ''),
  );
  readonly folderIndex = computed(() => flattenTree(this.tree()));
  readonly breadcrumb = computed(() => pathToRoot(this.folderIndex(), this.selectedFolderId()));

  readonly visibleFiles = computed(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const scope = this.scopeFilter();
    const folder = this.selectedFolderId();
    return this.files()
      .filter((f) => (q ? true : folder === null || f.folderId === folder))
      .filter(
        (f) =>
          !q ||
          f.name.toLowerCase().includes(q) ||
          (f.styleDescriptorText ?? '').toLowerCase().includes(q),
      )
      .filter((f) => !scope || f.scopes.includes(scope))
      .sort((a, b) => b.priority - a.priority || a.name.localeCompare(b.name));
  });

  readonly filesByScope = computed(() => groupByScopes(this.files()));

  readonly contextCountFor = (m: Modality) =>
    computed(
      () =>
        this.files().filter((f) => f.scopes.includes('ALWAYS_INCLUDE') || f.scopes.includes(m))
          .length,
    );

  readonly pendingVision = computed(
    () =>
      this.files().filter((f) => f.visionStatus === 'PENDING' || f.visionStatus === 'RUNNING')
        .length,
  );

  constructor() {
    effect(() => {
      const pid = this.studio.activeProjectId();
      untracked(() => {
        if (pid) {
          void this.loadProject(pid);
        } else {
          this.reset();
        }
      });
    });

    this.socket.on('vault:file-updated', (e) => {
      if (e.projectId !== this.studio.activeProjectId()) return;
      this.files.update((l) => upsertById(l, e.file));
      if (this.openFile()?.id === e.file.id && !this.isDirty()) {
        void this.reloadOpenFile();
      }
    });
  }

  reset(): void {
    this.tree.set(null);
    this.files.set([]);
    this.voiceProfiles.set([]);
    this.selectedFolderId.set(null);
    this.selectedFileId.set(null);
    this.openFile.set(null);
  }

  async loadProject(projectId: string): Promise<void> {
    try {
      const [tree, files, voices] = await Promise.all([
        this.api.getTree(projectId),
        this.api.listFiles(projectId),
        this.voiceApi.list(projectId),
      ]);
      this.tree.set(tree);
      this.files.set(files);
      this.voiceProfiles.set(voices);
      const currentFolder = this.selectedFolderId();
      if (!currentFolder || !flattenTree(tree).has(currentFolder)) {
        const firstChild = tree.children[0]?.id ?? tree.id;
        this.selectedFolderId.set(firstChild);
      }
      this.openFile.set(null);
      this.selectedFileId.set(null);
    } catch {
      // handled by error interceptor
    }
  }

  async refreshTree(): Promise<void> {
    const pid = this.studio.activeProjectId();
    if (!pid) return;
    const tree = await this.api.getTree(pid);
    this.tree.set(tree);
  }

  selectFolder(folderId: string | null): void {
    this.selectedFolderId.set(folderId);
    this.openFile.set(null);
    this.selectedFileId.set(null);
  }

  async openFileById(fileId: string): Promise<VaultFileDetailModel> {
    this.selectedFileId.set(fileId);
    const detail = await this.api.getFile(fileId);
    this.openFile.set(detail);
    this.selectedFolderId.set(detail.folderId);
    return detail;
  }

  async reloadOpenFile(): Promise<void> {
    const id = this.openFile()?.id;
    if (!id) return;
    const detail = await this.api.getFile(id);
    this.openFile.set(detail);
  }

  async saveDraft(): Promise<void> {
    const cur = this.openFile();
    if (!cur || !this.isDirty()) return;
    this.saving.set(true);
    try {
      const updated = await this.api.updateFile(cur.id, {
        contentText: this.draftContent(),
      });
      this.openFile.set(updated);
      this.files.update((l) => upsertById(l, updated));
      this.toast.success(`Saved ${updated.name}`);
    } finally {
      this.saving.set(false);
    }
  }

  async createFolder(parentId: string, name: string): Promise<VaultFolderModel | null> {
    const pid = this.studio.activeProjectId();
    if (!pid) return null;
    const folder = await this.api.createFolder(pid, { parentId, name });
    await this.refreshTree();
    this.selectedFolderId.set(folder.id);
    return folder;
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    await this.api.updateFolder(folderId, { name });
    const pid = this.studio.activeProjectId();
    if (pid) {
      const [tree, files] = await Promise.all([
        this.api.getTree(pid),
        this.api.listFiles(pid),
      ]);
      this.tree.set(tree);
      this.files.set(files);
    }
  }

  async moveFolder(folderId: string, newParentId: string): Promise<void> {
    if (folderId === newParentId) return;
    await this.api.updateFolder(folderId, { parentId: newParentId });
    const pid = this.studio.activeProjectId();
    if (pid) {
      const [tree, files] = await Promise.all([
        this.api.getTree(pid),
        this.api.listFiles(pid),
      ]);
      this.tree.set(tree);
      this.files.set(files);
    }
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.api.deleteFolder(folderId, true);
    const pid = this.studio.activeProjectId();
    if (pid) {
      await this.loadProject(pid);
    }
  }

  async createTextFile(dto: CreateTextFileDto): Promise<VaultFileDetailModel | null> {
    const pid = this.studio.activeProjectId();
    if (!pid) return null;
    const created = await this.api.createTextFile(pid, dto);
    this.files.update((l) => upsertById(l, created));
    this.openFile.set(created);
    this.selectedFileId.set(created.id);
    await this.refreshTree();
    void this.studio.refreshStats();
    return created;
  }

  uploadFiles(
    fileList: FileList | File[],
    folderId: string,
    scopes: ContextScope[],
    runVision = true,
  ): void {
    const pid = this.studio.activeProjectId();
    if (!pid) return;
    const files = Array.from(fileList);
    for (const file of files) {
      const taskId = `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      this.uploads.update((u) => [
        ...u,
        { id: taskId, name: file.name, progress: 0, status: 'uploading' },
      ]);

      this.api
        .uploadFile(pid, file, { folderId, scopes, priority: 50, runVision })
        .subscribe({
          next: (event) => {
            if (event.type === HttpEventType.UploadProgress && event.total) {
              const pct = Math.round((event.loaded / event.total) * 100);
              this.uploads.update((u) =>
                u.map((item) => (item.id === taskId ? { ...item, progress: pct } : item)),
              );
            } else if (event.type === HttpEventType.Response && event.body) {
              const uploaded = event.body;
              this.files.update((l) => upsertById(l, uploaded));
              this.uploads.update((u) =>
                u.map((item) =>
                  item.id === taskId ? { ...item, progress: 100, status: 'done' } : item,
                ),
              );
              void this.refreshTree();
              void this.studio.refreshStats();
              setTimeout(() => {
                this.uploads.update((u) => u.filter((item) => item.id !== taskId));
              }, 3500);
            }
          },
          error: (err: unknown) => {
            const msg = err instanceof Error ? err.message : 'Upload failed';
            this.uploads.update((u) =>
              u.map((item) =>
                item.id === taskId ? { ...item, status: 'error', error: msg } : item,
              ),
            );
            this.toast.error(`Failed to upload ${file.name}: ${msg}`);
          },
        });
    }
  }

  async updateFileMetadata(
    fileId: string,
    patch: {
      name?: string;
      folderId?: string;
      scopes?: ContextScope[];
      priority?: number;
      description?: string;
      styleDescriptorText?: string | null;
    },
  ): Promise<VaultFileDetailModel> {
    const updated = await this.api.updateFile(fileId, patch);
    this.files.update((l) => upsertById(l, updated));
    if (this.openFile()?.id === fileId) {
      this.openFile.set(updated);
    }
    return updated;
  }

  async updateScopes(fileId: string, scopes: ContextScope[]): Promise<void> {
    await this.updateFileMetadata(fileId, { scopes });
  }

  async updatePriority(fileId: string, priority: number): Promise<void> {
    await this.updateFileMetadata(fileId, { priority });
  }

  async renameFile(fileId: string, name: string): Promise<void> {
    await this.updateFileMetadata(fileId, { name });
  }

  async moveFile(fileId: string, folderId: string): Promise<void> {
    await this.updateFileMetadata(fileId, { folderId });
    await this.refreshTree();
  }

  async deleteFile(fileId: string): Promise<void> {
    await this.api.deleteFile(fileId);
    this.files.update((l) => l.filter((f) => f.id !== fileId));
    if (this.openFile()?.id === fileId) {
      this.openFile.set(null);
    }
    if (this.selectedFileId() === fileId) {
      this.selectedFileId.set(null);
    }
    await this.refreshTree();
    void this.studio.refreshStats();
  }

  async analyzeVision(fileId: string, middlemanProfileId?: string): Promise<void> {
    const updated = await this.api.analyzeVision(
      fileId,
      middlemanProfileId ? { middlemanProfileId } : {},
    );
    this.files.update((l) => upsertById(l, updated));
    if (this.openFile()?.id === fileId) {
      this.openFile.update((cur) => (cur ? { ...cur, ...updated } : null));
    }
    this.toast.info(`Vision analysis queued for ${updated.name}`);
  }

  async search(q: string): Promise<VaultFileModel[]> {
    const pid = this.studio.activeProjectId();
    if (!pid) return [];
    return this.api.searchFiles(pid, { q, limit: 20 });
  }

  async createVoiceProfile(dto: UpsertVoiceProfileDto): Promise<VoiceProfileModel | null> {
    const pid = this.studio.activeProjectId();
    if (!pid) return null;
    const created = await this.voiceApi.create(pid, dto);
    this.voiceProfiles.update((l) => [...l, created]);
    return created;
  }

  async updateVoiceProfile(
    voiceId: string,
    dto: Partial<UpsertVoiceProfileDto>,
  ): Promise<VoiceProfileModel> {
    const updated = await this.voiceApi.update(voiceId, dto);
    this.voiceProfiles.update((l) => l.map((v) => (v.id === voiceId ? updated : v)));
    return updated;
  }

  async deleteVoiceProfile(voiceId: string): Promise<void> {
    await this.voiceApi.delete(voiceId);
    this.voiceProfiles.update((l) => l.filter((v) => v.id !== voiceId));
  }
}
