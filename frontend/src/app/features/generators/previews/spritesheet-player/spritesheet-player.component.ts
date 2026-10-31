import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AssetModel } from '@forge/shared';
import { triggerDownload } from '../../../../core/utils/download';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { SliderComponent } from '../../../../ui/slider/slider.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';

@Component({
  selector: 'fs-spritesheet-player',
  standalone: true,
  imports: [ButtonComponent, SliderComponent, ToggleComponent],
  templateUrl: './spritesheet-player.component.html',
  styleUrl: './spritesheet-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SpritesheetPlayerComponent {
  private readonly destroyRef = inject(DestroyRef);

  readonly asset = input.required<AssetModel>();
  readonly previewCanvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('previewCanvas');

  readonly playing = signal(true);
  readonly fps = signal(12);
  readonly pingPong = signal(false);
  readonly onionSkin = signal(false);
  readonly showGridOverlay = signal(true);
  readonly currentFrame = signal(0);

  private sheetImage: HTMLImageElement | null = null;
  private animTimer: ReturnType<typeof setInterval> | null = null;
  private direction: 1 | -1 = 1;
  private viewReady = false;

  readonly frameCount = computed(() => {
    const m = this.asset().metadata;
    if (m.modality === 'OTHER' && m.frameCount) return m.frameCount;
    return 16;
  });

  readonly columns = computed(() => {
    const m = this.asset().metadata;
    if (m.modality === 'OTHER' && m.columns) return m.columns;
    return 4;
  });

  readonly rows = computed(() => Math.max(1, Math.ceil(this.frameCount() / this.columns())));

  readonly frameCells = computed(() =>
    Array.from({ length: this.frameCount() }, (_, i) => i),
  );

  readonly metadataFile = computed(() =>
    this.asset().files.find((f) => f.role === 'METADATA'),
  );

  readonly formatFps = (v: number): string => `${Math.round(v)} fps`;

  constructor() {
    afterNextRender(() => {
      this.viewReady = true;
      this.drawCurrentFrame();
    });

    effect(() => {
      const a = this.asset();
      untracked(() => {
        if (a.metadata.modality === 'OTHER' && a.metadata.fps) {
          this.fps.set(a.metadata.fps);
        }
        this.currentFrame.set(0);
        this.direction = 1;
        this.loadSheetImage(a.primaryUrl);
      });
    });

    effect(() => {
      const isPlaying = this.playing();
      const rate = this.fps();
      untracked(() => {
        this.restartTimer(isPlaying, rate);
      });
    });

    this.destroyRef.onDestroy(() => {
      this.stopTimer();
    });
  }

  togglePlay(): void {
    this.playing.update((v) => !v);
  }

  selectFrame(index: number): void {
    this.playing.set(false);
    this.currentFrame.set(index);
    this.drawCurrentFrame();
  }

  downloadSheet(): void {
    const primary = this.asset().files.find((f) => f.role === 'PRIMARY');
    triggerDownload(primary?.downloadUrl ?? this.asset().primaryUrl, `${this.asset().title}.png`);
  }

  downloadMetadataJson(): void {
    const metaFile = this.metadataFile();
    if (metaFile) {
      triggerDownload(metaFile.downloadUrl, metaFile.fileName);
      return;
    }
    const payload = {
      title: this.asset().title,
      frameCount: this.frameCount(),
      columns: this.columns(),
      rows: this.rows(),
      fps: this.fps(),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    triggerDownload(url, `${this.asset().title}_atlas.json`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  private loadSheetImage(url: string): void {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      this.sheetImage = img;
      this.drawCurrentFrame();
    };
    img.src = url;
  }

  private restartTimer(isPlaying: boolean, rate: number): void {
    this.stopTimer();
    if (!isPlaying) return;
    const intervalMs = Math.max(16, Math.round(1000 / Math.max(1, rate)));
    this.animTimer = setInterval(() => {
      this.stepFrame();
    }, intervalMs);
  }

  private stopTimer(): void {
    if (this.animTimer !== null) {
      clearInterval(this.animTimer);
      this.animTimer = null;
    }
  }

  private stepFrame(): void {
    const total = this.frameCount();
    if (total <= 1) return;
    let next = this.currentFrame() + this.direction;
    if (this.pingPong()) {
      if (next >= total) {
        this.direction = -1;
        next = Math.max(0, total - 2);
      } else if (next < 0) {
        this.direction = 1;
        next = Math.min(total - 1, 1);
      }
    } else {
      next = ((next % total) + total) % total;
    }
    this.currentFrame.set(next);
    this.drawCurrentFrame();
  }

  private drawCurrentFrame(): void {
    if (!this.viewReady) return;
    const canvas = this.previewCanvasRef()?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    const img = this.sheetImage;
    if (!img || !img.naturalWidth || !img.naturalHeight) return;

    const cols = this.columns();
    const rws = this.rows();
    const frameW = Math.floor(img.naturalWidth / cols);
    const frameH = Math.floor(img.naturalHeight / rws);

    const cur = this.currentFrame();
    if (this.onionSkin() && this.frameCount() > 1) {
      const prev = (cur - 1 + this.frameCount()) % this.frameCount();
      const prevCol = prev % cols;
      const prevRow = Math.floor(prev / cols);
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.drawImage(img, prevCol * frameW, prevRow * frameH, frameW, frameH, 0, 0, w, h);
      ctx.restore();
    }

    const col = cur % cols;
    const row = Math.floor(cur / cols);
    ctx.save();
    ctx.globalAlpha = 1.0;
    ctx.drawImage(img, col * frameW, row * frameH, frameW, frameH, 0, 0, w, h);
    ctx.restore();
  }
}
