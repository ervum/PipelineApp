import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';
import { VaultFileDetailModel } from '@forge/shared';
import { triggerDownload } from '../../../core/utils/download';
import { formatBytes } from '../../../core/utils/format';
import { ButtonComponent } from '../../../ui/button/button.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { ModelViewportComponent } from '../../generators/previews/model-viewport/model-viewport.component';
import { WaveformPlayerComponent } from '../../generators/previews/waveform-player/waveform-player.component';

@Component({
  selector: 'fs-media-preview',
  standalone: true,
  imports: [ButtonComponent, IconComponent, WaveformPlayerComponent, ModelViewportComponent],
  templateUrl: './media-preview.component.html',
  styleUrl: './media-preview.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MediaPreviewComponent {
  readonly file = input.required<VaultFileDetailModel>();
  readonly zoom = signal<number>(1);
  readonly checkerBg = signal<boolean>(true);

  readonly formatBytes = formatBytes;

  zoomIn(): void {
    this.zoom.update((z) => Math.min(4, +(z + 0.25).toFixed(2)));
  }

  zoomOut(): void {
    this.zoom.update((z) => Math.max(0.25, +(z - 0.25).toFixed(2)));
  }

  resetZoom(): void {
    this.zoom.set(1);
  }

  downloadFile(): void {
    const url = this.file().contentUrl;
    if (url) {
      triggerDownload(url, this.file().name);
    }
  }
}
