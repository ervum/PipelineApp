import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ApprovalStatus,
  AssetFileModel,
  AssetModel,
  CONTEXT_SCOPES,
  CONTEXT_SCOPE_LABEL,
  ContextScope,
  ExecutionMode,
  JobModel,
  modalityToScope,
} from '@forge/shared';
import { AssetGalleryStore } from '../../../../core/state/asset-gallery.store';
import { GeneratorJobStore } from '../../../../core/state/generator-job.store';
import { ToastService } from '../../../../core/state/toast.service';
import { VaultStateService } from '../../../../core/state/vault-state.service';
import { formatBytes } from '../../../../core/utils/format';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { ChipInputComponent } from '../../../../ui/chip-input/chip-input.component';
import { ConfirmDialogService } from '../../../../ui/confirm-dialog/confirm-dialog.service';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { ModalComponent } from '../../../../ui/modal/modal.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { TierBadgeComponent } from '../../../../ui/tier-badge/tier-badge.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';
import { ContextSourcesListComponent } from '../../middleman/context-sources-list/context-sources-list.component';
import { PromptDiffComponent } from '../../middleman/prompt-diff/prompt-diff.component';

export interface ReRunPayload {
  asset: AssetModel;
  job: JobModel | null;
}

@Component({
  selector: 'fs-asset-inspector',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    ChipInputComponent,
    IconComponent,
    ModalComponent,
    SegmentedControlComponent,
    SelectComponent,
    TierBadgeComponent,
    ToggleComponent,
    PromptDiffComponent,
    ContextSourcesListComponent,
  ],
  templateUrl: './asset-inspector.component.html',
  styleUrl: './asset-inspector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetInspectorComponent {
  readonly gallery = inject(AssetGalleryStore);
  private readonly jobStore = inject(GeneratorJobStore);
  private readonly vault = inject(VaultStateService);
  private readonly confirm = inject(ConfirmDialogService);
  private readonly toast = inject(ToastService);

  readonly asset = input.required<AssetModel>();
  readonly closed = output<void>();
  readonly reRunWithEdits = output<ReRunPayload>();

  readonly titleDraft = linkedSignal<AssetModel, string>({
    source: this.asset,
    computation: (a) => a.title,
  });

  readonly notesDraft = linkedSignal<AssetModel, string>({
    source: this.asset,
    computation: (a) => a.notes,
  });

  readonly saveModalOpen = signal(false);
  readonly selectedFolderId = signal<string | null>(null);
  readonly selectedScopes = signal<ContextScope[]>([]);
  readonly runVision = signal(true);
  readonly savingToVault = signal(false);
  readonly busyVariation = signal(false);

  readonly allScopes = CONTEXT_SCOPES;
  readonly scopeLabels = CONTEXT_SCOPE_LABEL;
  readonly formatBytes = formatBytes;

  readonly approvalOptions: ReadonlyArray<SegmentedOption<ApprovalStatus>> = [
    { value: 'DRAFT', label: 'Draft' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'FINAL', label: 'Final' },
    { value: 'REJECTED', label: 'Rejected' },
  ];

  readonly sourceJob = computed<JobModel | null>(() => {
    const jid = this.asset().jobId;
    return jid ? (this.jobStore.jobs()[jid] ?? null) : null;
  });

  readonly lineageAssets = computed<AssetModel[]>(() => {
    const grp = this.asset().assetGroupId;
    return this.gallery
      .items()
      .filter((a) => a.assetGroupId === grp)
      .sort((a, b) => a.version - b.version);
  });

  readonly folderOptions = computed<SelectOption<string>[]>(() =>
    Array.from(this.vault.folderIndex().values()).map((f) => ({
      value: f.id,
      label: f.path || f.name,
    })),
  );

  constructor() {
    effect(() => {
      const a = this.asset();
      const defaultScope = modalityToScope(a.modality);
      this.selectedScopes.set([defaultScope]);
      const folders = Array.from(this.vault.folderIndex().values());
      const refFolder =
        folders.find((f) => f.path.toLowerCase().includes('reference')) ?? folders[0] ?? null;
      this.selectedFolderId.set(refFolder?.id ?? null);
    });
  }

  commitTitle(): void {
    const trimmed = this.titleDraft().trim();
    if (!trimmed || trimmed === this.asset().title) return;
    void this.gallery.rename(this.asset().id, trimmed);
  }

  commitNotes(): void {
    const next = this.notesDraft();
    if (next === this.asset().notes) return;
    void this.gallery.updateNotes(this.asset().id, next);
  }

  onApprovalChange(status: ApprovalStatus): void {
    void this.gallery.setApproval(this.asset().id, status);
  }

  onTagsChange(tags: string[]): void {
    void this.gallery.tag(this.asset().id, tags);
  }

  copySeed(): void {
    const s = this.asset().seed;
    if (s === null || !navigator.clipboard) return;
    void navigator.clipboard.writeText(String(s));
    this.toast.info(`Copied seed ${s}`);
  }

  selectLineageVersion(item: AssetModel): void {
    this.gallery.selectedAssetId.set(item.id);
  }

  downloadFile(file: AssetFileModel): void {
    this.gallery.download(file);
  }

  exportPrimary(): void {
    const primary = this.asset().files.find((f) => f.role === 'PRIMARY') ?? this.asset().files[0];
    if (primary) {
      this.gallery.download(primary);
    }
  }

  exportAllFiles(): void {
    for (const file of this.asset().files) {
      this.gallery.download(file);
    }
  }

  openSaveToVaultModal(): void {
    this.saveModalOpen.set(true);
  }

  toggleScope(scope: ContextScope): void {
    this.selectedScopes.update((list) =>
      list.includes(scope) ? list.filter((s) => s !== scope) : [...list, scope],
    );
  }

  async confirmSaveToVault(): Promise<void> {
    const folderId = this.selectedFolderId();
    if (!folderId || this.savingToVault()) return;
    this.savingToVault.set(true);
    try {
      await this.gallery.saveToVault(
        this.asset().id,
        folderId,
        this.selectedScopes(),
        this.runVision(),
      );
      this.saveModalOpen.set(false);
    } finally {
      this.savingToVault.set(false);
    }
  }

  async createVariation(mode: ExecutionMode): Promise<void> {
    if (this.busyVariation()) return;
    this.busyVariation.set(true);
    try {
      const job = await this.gallery.variation(this.asset().id, mode);
      this.jobStore.upsert(job);
      this.jobStore.focus(job.modality, job.id);
      this.toast.info(`Dispatched variation v${this.asset().version + 1}`);
    } finally {
      this.busyVariation.set(false);
    }
  }

  triggerReRunWithEdits(): void {
    this.reRunWithEdits.emit({
      asset: this.asset(),
      job: this.sourceJob(),
    });
  }

  async deleteAsset(): Promise<void> {
    const res = await this.confirm.confirm({
      title: 'Delete Generated Asset',
      message: `Are you sure you want to permanently delete "${this.asset().title}" and its ${this.asset().files.length} stored file(s)?`,
      confirmLabel: 'Delete Asset',
      danger: true,
    });
    if (res === 'confirm') {
      await this.gallery.delete(this.asset().id);
      this.closed.emit();
    }
  }
}
