import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { AssetModel } from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';

@Component({
  selector: 'fs-image-previewer',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  templateUrl: './image-previewer.component.html',
  styleUrl: './image-previewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImagePreviewerComponent {
  readonly asset = input.required<AssetModel>();
  readonly compareAsset = input<AssetModel | null>(null);
  readonly batchAssets = input<ReadonlyArray<AssetModel>>([]);
  readonly selectBatchAsset = output<AssetModel>();
  readonly clearCompare = output<void>();

  readonly zoom = signal(1);
  readonly panX = signal(0);
  readonly panY = signal(0);
  readonly isPanning = signal(false);
  readonly tileMode = signal(false);
  readonly compareSplit = signal(50);

  private dragStartX = 0;
  private dragStartY = 0;
  private startPanX = 0;
  private startPanY = 0;

  readonly isTileableAsset = computed(() => {
    const meta = this.asset().metadata;
    if (meta.modality === 'IMAGES') {
      return meta.tileable;
    }
    return false;
  });

  readonly tileSeamScore = computed<number | null>(() => {
    const meta = this.asset().metadata;
    if (meta.modality === 'IMAGES' && typeof meta.tileSeamScore === 'number') {
      return meta.tileSeamScore;
    }
    return null;
  });

  readonly seamBadgeClass = computed(() => {
    const s = this.tileSeamScore();
    if (s === null) return '';
    if (s >= 0.85) return 'is-good';
    if (s >= 0.65) return 'is-warn';
    return 'is-bad';
  });

  readonly dimensionsText = computed(() => {
    const meta = this.asset().metadata;
    if (meta.modality === 'IMAGES' || meta.modality === 'ICONS_2D') {
      return `${meta.width} × ${meta.height}`;
    }
    const f = this.asset().files[0];
    if (f?.width && f?.height) {
      return `${f.width} × ${f.height}`;
    }
    return null;
  });

  constructor() {
    effect(() => {
      const tileable = this.isTileableAsset();
      this.tileMode.set(tileable);
    });
  }

  onWheel(event: WheelEvent): void {
    event.preventDefault();
    const delta = event.deltaY < 0 ? 0.15 : -0.15;
    this.zoom.update((z) => Math.min(5, Math.max(0.25, +(z + delta).toFixed(2))));
  }

  onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    this.isPanning.set(true);
    this.dragStartX = event.clientX;
    this.dragStartY = event.clientY;
    this.startPanX = this.panX();
    this.startPanY = this.panY();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.isPanning()) return;
    this.panX.set(this.startPanX + (event.clientX - this.dragStartX));
    this.panY.set(this.startPanY + (event.clientY - this.dragStartY));
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.isPanning()) return;
    this.isPanning.set(false);
    try {
      (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  }

  resetView(): void {
    this.zoom.set(1);
    this.panX.set(0);
    this.panY.set(0);
  }

  zoomIn(): void {
    this.zoom.update((z) => Math.min(5, +(z + 0.25).toFixed(2)));
  }

  zoomOut(): void {
    this.zoom.update((z) => Math.max(0.25, +(z - 0.25).toFixed(2)));
  }

  onCompareSliderInput(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(val)) {
      this.compareSplit.set(val);
    }
  }
}
