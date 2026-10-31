import { ChangeDetectionStrategy, Component, inject, output, signal } from '@angular/core';
import {
  CONTEXT_SCOPES,
  CONTEXT_SCOPE_LABEL,
  ContextScope,
  VaultFileModel,
} from '@forge/shared';
import { ToastService } from '../../../core/state/toast.service';
import { VaultStateService } from '../../../core/state/vault-state.service';
import { accentForScope, iconForVaultKind } from '../../../core/utils/file-kind';
import { formatBytes, formatRelativeTime } from '../../../core/utils/format';
import { isModKey } from '../../../core/utils/keyboard';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { StatusPillComponent } from '../../../ui/status-pill/status-pill.component';

@Component({
  selector: 'fs-file-browser',
  standalone: true,
  imports: [ButtonComponent, IconComponent, EmptyStateComponent, StatusPillComponent],
  templateUrl: './file-browser.component.html',
  styleUrl: './file-browser.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileBrowserComponent {
  readonly vault = inject(VaultStateService);
  private readonly toast = inject(ToastService);

  readonly fileOpen = output<VaultFileModel>();
  readonly requestNewFile = output<void>();
  readonly requestUpload = output<void>();

  readonly selectedIds = signal<Set<string>>(new Set());
  readonly bulkScopeToApply = signal<ContextScope>('ALWAYS_INCLUDE');

  readonly allScopes = CONTEXT_SCOPES;
  readonly scopeLabels = CONTEXT_SCOPE_LABEL;
  readonly iconForVaultKind = iconForVaultKind;
  readonly accentForScope = accentForScope;
  readonly formatBytes = formatBytes;
  readonly formatRelativeTime = formatRelativeTime;

  onRowClick(file: VaultFileModel, event: MouseEvent): void {
    const list = this.vault.visibleFiles();
    if (isModKey(event)) {
      this.selectedIds.update((set) => {
        const next = new Set(set);
        if (next.has(file.id)) {
          next.delete(file.id);
        } else {
          next.add(file.id);
        }
        return next;
      });
      this.vault.selectedFileId.set(file.id);
      return;
    }

    if (event.shiftKey && this.vault.selectedFileId()) {
      const anchorIdx = list.findIndex((f) => f.id === this.vault.selectedFileId());
      const curIdx = list.findIndex((f) => f.id === file.id);
      if (anchorIdx !== -1 && curIdx !== -1) {
        const [start, end] = anchorIdx < curIdx ? [anchorIdx, curIdx] : [curIdx, anchorIdx];
        const rangeIds = list.slice(start, end + 1).map((f) => f.id);
        this.selectedIds.set(new Set(rangeIds));
        return;
      }
    }

    this.selectedIds.set(new Set([file.id]));
    this.vault.selectedFileId.set(file.id);
  }

  onRowDoubleClick(file: VaultFileModel): void {
    this.fileOpen.emit(file);
  }

  isSelected(fileId: string): boolean {
    return this.selectedIds().has(fileId) || this.vault.selectedFileId() === fileId;
  }

  onFileDragStart(file: VaultFileModel, event: DragEvent): void {
    event.dataTransfer?.setData('application/x-forge-file-id', file.id);
  }

  async bulkAddScope(): Promise<void> {
    const scope = this.bulkScopeToApply();
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0) return;
    const filesMap = new Map(this.vault.files().map((f) => [f.id, f]));
    await Promise.all(
      ids.map(async (id) => {
        const f = filesMap.get(id);
        if (!f || f.scopes.includes(scope)) return;
        await this.vault.updateScopes(id, [...f.scopes, scope]);
      }),
    );
    this.toast.success(`Added scope "${this.scopeLabels[scope]}" to ${ids.length} files`);
  }

  async bulkRemoveScope(): Promise<void> {
    const scope = this.bulkScopeToApply();
    const ids = Array.from(this.selectedIds());
    if (ids.length === 0) return;
    const filesMap = new Map(this.vault.files().map((f) => [f.id, f]));
    await Promise.all(
      ids.map(async (id) => {
        const f = filesMap.get(id);
        if (!f || !f.scopes.includes(scope)) return;
        await this.vault.updateScopes(
          id,
          f.scopes.filter((s) => s !== scope),
        );
      }),
    );
    this.toast.info(`Removed scope "${this.scopeLabels[scope]}" from ${ids.length} files`);
  }

  clearSelection(): void {
    this.selectedIds.set(new Set());
  }
}
