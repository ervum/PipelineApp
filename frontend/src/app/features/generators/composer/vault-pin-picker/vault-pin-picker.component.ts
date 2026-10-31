import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CONTEXT_SCOPES,
  CONTEXT_SCOPE_LABEL,
  ContextScope,
  VaultFileModel,
} from '@forge/shared';
import { VaultStateService } from '../../../../core/state/vault-state.service';
import { iconForKind } from '../../../../core/utils/file-kind';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { ModalComponent } from '../../../../ui/modal/modal.component';

@Component({
  selector: 'fs-vault-pin-picker',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, ModalComponent],
  templateUrl: './vault-pin-picker.component.html',
  styleUrl: './vault-pin-picker.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VaultPinPickerComponent {
  readonly vault = inject(VaultStateService);

  readonly pinnedFileIds = model<string[]>([]);

  readonly modalOpen = signal(false);
  readonly searchQuery = signal('');
  readonly scopeFilter = signal<ContextScope | null>(null);

  readonly scopes = CONTEXT_SCOPES;
  readonly scopeLabels = CONTEXT_SCOPE_LABEL;
  readonly iconForKind = iconForKind;

  readonly pinnedFiles = computed<VaultFileModel[]>(() => {
    const ids = new Set(this.pinnedFileIds());
    return this.vault.files().filter((f) => ids.has(f.id));
  });

  readonly filteredVaultFiles = computed<VaultFileModel[]>(() => {
    const q = this.searchQuery().trim().toLowerCase();
    const scope = this.scopeFilter();
    return this.vault
      .files()
      .filter((f) => !q || f.name.toLowerCase().includes(q) || f.folderPath.toLowerCase().includes(q))
      .filter((f) => !scope || f.scopes.includes(scope));
  });

  isPinned(fileId: string): boolean {
    return this.pinnedFileIds().includes(fileId);
  }

  togglePin(fileId: string): void {
    const cur = this.pinnedFileIds();
    if (cur.includes(fileId)) {
      this.pinnedFileIds.set(cur.filter((id) => id !== fileId));
    } else if (cur.length < 12) {
      this.pinnedFileIds.set([...cur, fileId]);
    }
  }

  removePin(fileId: string): void {
    this.pinnedFileIds.update((ids) => ids.filter((id) => id !== fileId));
  }
}
