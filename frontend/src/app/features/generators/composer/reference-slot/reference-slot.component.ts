import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { AssetModel, VaultFileModel } from '@forge/shared';
import { VaultApi } from '../../../../core/api/vault.api';
import { AssetGalleryStore } from '../../../../core/state/asset-gallery.store';
import { StudioStateService } from '../../../../core/state/studio-state.service';
import { ToastService } from '../../../../core/state/toast.service';
import { VaultStateService } from '../../../../core/state/vault-state.service';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { DropzoneComponent } from '../../../../ui/dropzone/dropzone.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { ModalComponent } from '../../../../ui/modal/modal.component';

@Component({
  selector: 'fs-reference-slot',
  standalone: true,
  imports: [ButtonComponent, DropzoneComponent, IconComponent, ModalComponent],
  templateUrl: './reference-slot.component.html',
  styleUrl: './reference-slot.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReferenceSlotComponent {
  private readonly vaultApi = inject(VaultApi);
  private readonly studio = inject(StudioStateService);
  private readonly toast = inject(ToastService);
  readonly vault = inject(VaultStateService);
  readonly gallery = inject(AssetGalleryStore);

  readonly label = input<string>('Reference Image');
  readonly required = input<boolean>(false);
  readonly error = input<string | null>(null);
  readonly storageKey = model<string | null>(null);

  readonly uploading = signal(false);
  readonly previewUrl = signal<string | null>(null);
  readonly previewLabel = signal<string>('');
  readonly vaultPickerOpen = signal(false);
  readonly historyPickerOpen = signal(false);

  readonly vaultImages = computed<VaultFileModel[]>(() =>
    this.vault.files().filter((f) => f.kind === 'IMAGE'),
  );

  readonly historyImages = computed<AssetModel[]>(() =>
    this.gallery
      .items()
      .filter(
        (a) =>
          a.modality === 'ICONS_2D' ||
          a.modality === 'IMAGES' ||
          Boolean(a.thumbnailUrl),
      ),
  );

  async onFilesDropped(files: File[]): Promise<void> {
    const file = files[0];
    if (!file) return;
    await this.uploadFile(file, file.name);
  }

  async pickVaultImage(file: VaultFileModel): Promise<void> {
    this.vaultPickerOpen.set(false);
    const url = file.contentUrl ?? file.thumbnailUrl;
    if (!url) return;
    await this.uploadFromUrl(url, file.name);
  }

  async pickHistoryAsset(asset: AssetModel): Promise<void> {
    this.historyPickerOpen.set(false);
    const url = asset.primaryUrl || asset.thumbnailUrl;
    if (!url) return;
    await this.uploadFromUrl(url, `${asset.title}.png`);
  }

  clearReference(): void {
    this.storageKey.set(null);
    this.previewUrl.set(null);
    this.previewLabel.set('');
  }

  private async uploadFromUrl(url: string, fileName: string): Promise<void> {
    this.uploading.set(true);
    try {
      const resp = await fetch(url);
      const blob = await resp.blob();
      const file = new File([blob], fileName, {
        type: blob.type || 'image/png',
      });
      await this.uploadFile(file, fileName);
    } catch {
      this.toast.error('Failed to load selected reference image.');
    } finally {
      this.uploading.set(false);
    }
  }

  private async uploadFile(file: File, displayLabel: string): Promise<void> {
    const projectId = this.studio.activeProjectId();
    if (!projectId) {
      this.toast.warn('Select an active project before uploading a reference.');
      return;
    }

    this.uploading.set(true);
    try {
      const res = await this.vaultApi.uploadReference(projectId, file);
      this.storageKey.set(res.storageKey);
      this.previewUrl.set(res.url);
      this.previewLabel.set(`${displayLabel} (${res.width}×${res.height})`);
    } finally {
      this.uploading.set(false);
    }
  }
}
