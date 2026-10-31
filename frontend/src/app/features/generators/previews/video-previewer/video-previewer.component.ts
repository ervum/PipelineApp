import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AssetFileModel, AssetModel } from '@forge/shared';
import { ToastService } from '../../../../core/state/toast.service';
import { triggerDownload } from '../../../../core/utils/download';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';

@Component({
  selector: 'fs-video-previewer',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  templateUrl: './video-previewer.component.html',
  styleUrl: './video-previewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoPreviewerComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly toast = inject(ToastService);

  readonly asset = input.required<AssetModel>();
  readonly compareAsset = input<AssetModel | null>(null);
  readonly batchAssets = input<ReadonlyArray<AssetModel>>([]);
  readonly selectBatchAsset = output<AssetModel>();
  readonly clearCompare = output<void>();

  readonly videoElRef = viewChild<ElementRef<HTMLVideoElement>>('videoPlayer');

  readonly playing = signal(true);
  readonly loop = signal(true);
  readonly playbackRate = signal<0.25 | 0.5 | 1 | 2>(1);
  readonly currentFrameIndex = signal(0);
  readonly nativeCurrentTime = signal(0);
  readonly nativeDuration = signal(4);

  readonly speedOptions: ReadonlyArray<0.25 | 0.5 | 1 | 2> = [0.25, 0.5, 1, 2];

  private deckTimer: ReturnType<typeof setInterval> | null = null;

  readonly primaryFile = computed<AssetFileModel | undefined>(() =>
    this.asset().files.find((f) => f.role === 'PRIMARY') ?? this.asset().files[0],
  );

  readonly isNativeVideo = computed<boolean>(() => {
    const mime = this.primaryFile()?.mimeType ?? '';
    return mime.startsWith('video/');
  });

  readonly frameFiles = computed<ReadonlyArray<AssetFileModel>>(() => {
    const frames = this.asset().files.filter((f) => f.role === 'FRAME');
    if (frames.length > 0) return frames;
    const primary = this.primaryFile();
    return primary ? [primary] : [];
  });

  readonly videoMeta = computed(() => {
    const m = this.asset().metadata;
    if (m.modality === 'VIDEO') {
      return m;
    }
    return {
      modality: 'VIDEO' as const,
      width: this.primaryFile()?.width ?? 1280,
      height: this.primaryFile()?.height ?? 720,
      durationMs: 4000,
      fps: 24,
      aspectRatio: '16:9',
      videoCategory: 'CUTSCENE',
      cameraMotion: 'STATIC',
      loopable: true,
      hasAudio: false,
      memoryStrategy: 'RAM_FALLBACK_32GB',
    };
  });

  readonly durationSec = computed(() =>
    Math.max(1, Math.round(this.videoMeta().durationMs / 1000)),
  );

  readonly totalFrames = computed(() => {
    if (this.isNativeVideo()) {
      return Math.max(1, Math.round(this.nativeDuration() * this.videoMeta().fps));
    }
    return Math.max(1, this.frameFiles().length);
  });

  readonly activeFrameUrl = computed(() => {
    const frames = this.frameFiles();
    if (frames.length === 0) return this.asset().primaryUrl;
    const idx = Math.min(frames.length - 1, Math.max(0, this.currentFrameIndex()));
    return frames[idx]?.url ?? this.asset().primaryUrl;
  });

  readonly timecodeText = computed(() => {
    const fps = this.videoMeta().fps || 24;
    if (this.isNativeVideo()) {
      const t = this.nativeCurrentTime();
      const mins = Math.floor(t / 60);
      const secs = Math.floor(t % 60);
      const frame = Math.floor((t % 1) * fps);
      return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(frame).padStart(2, '0')}`;
    }
    const idx = this.currentFrameIndex();
    const total = this.totalFrames();
    const simSec = (idx / Math.max(1, total)) * this.durationSec();
    const secs = Math.floor(simSec);
    const frame = Math.floor((simSec % 1) * fps);
    return `00:${String(secs).padStart(2, '0')}:${String(frame).padStart(2, '0')}`;
  });

  readonly scrubberMax = computed(() => {
    if (this.isNativeVideo()) {
      return Math.max(0.1, this.nativeDuration());
    }
    return Math.max(0, this.totalFrames() - 1);
  });

  readonly scrubberValue = computed(() => {
    if (this.isNativeVideo()) {
      return this.nativeCurrentTime();
    }
    return this.currentFrameIndex();
  });

  constructor() {
    effect(() => {
      const a = this.asset();
      untracked(() => {
        this.currentFrameIndex.set(0);
        this.nativeCurrentTime.set(0);
        if (a.metadata.modality === 'VIDEO') {
          this.loop.set(a.metadata.loopable);
          this.nativeDuration.set(Math.max(1, Math.round(a.metadata.durationMs / 1000)));
        }
        this.playing.set(true);
      });
    });

    effect(() => {
      const isPlaying = this.playing();
      const rate = this.playbackRate();
      const isVideo = this.isNativeVideo();
      const total = this.totalFrames();
      untracked(() => {
        if (isVideo) {
          this.stopDeckTimer();
          const v = this.videoElRef()?.nativeElement;
          if (v) {
            v.playbackRate = rate;
            if (isPlaying) {
              void v.play().catch(() => {});
            } else {
              v.pause();
            }
          }
        } else {
          this.restartDeckTimer(isPlaying, rate, total);
        }
      });
    });

    this.destroyRef.onDestroy(() => {
      this.stopDeckTimer();
    });
  }

  togglePlay(): void {
    this.playing.update((p) => !p);
  }

  toggleLoop(): void {
    this.loop.update((l) => !l);
    const v = this.videoElRef()?.nativeElement;
    if (v) {
      v.loop = this.loop();
    }
  }

  setSpeed(rate: 0.25 | 0.5 | 1 | 2): void {
    this.playbackRate.set(rate);
  }

  stepFrame(delta: -1 | 1): void {
    this.playing.set(false);
    if (this.isNativeVideo()) {
      const v = this.videoElRef()?.nativeElement;
      if (!v) return;
      const stepSec = 1 / (this.videoMeta().fps || 24);
      v.currentTime = Math.max(0, Math.min(v.duration || 4, v.currentTime + delta * stepSec));
      this.nativeCurrentTime.set(v.currentTime);
    } else {
      const total = this.totalFrames();
      const next = (this.currentFrameIndex() + delta + total) % total;
      this.currentFrameIndex.set(next);
    }
  }

  onScrubberInput(event: Event): void {
    const val = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(val)) return;
    if (this.isNativeVideo()) {
      const v = this.videoElRef()?.nativeElement;
      if (v) {
        v.currentTime = val;
      }
      this.nativeCurrentTime.set(val);
    } else {
      this.playing.set(false);
      this.currentFrameIndex.set(Math.round(val));
    }
  }

  onVideoTimeUpdate(event: Event): void {
    const v = event.target as HTMLVideoElement;
    this.nativeCurrentTime.set(v.currentTime);
    if (Number.isFinite(v.duration) && v.duration > 0) {
      this.nativeDuration.set(v.duration);
    }
  }

  onVideoEnded(): void {
    if (!this.loop()) {
      this.playing.set(false);
    }
  }

  captureStillFrame(): void {
    if (this.isNativeVideo()) {
      const v = this.videoElRef()?.nativeElement;
      if (!v) return;
      const canvas = document.createElement('canvas');
      canvas.width = v.videoWidth || this.videoMeta().width;
      canvas.height = v.videoHeight || this.videoMeta().height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL('image/png');
      triggerDownload(dataUrl, `${this.asset().title}_frame.png`);
      this.toast.success('Captured video still frame as PNG');
    } else {
      const url = this.activeFrameUrl();
      triggerDownload(
        url,
        `${this.asset().title}_frame_${this.currentFrameIndex() + 1}.png`,
      );
      this.toast.success(`Exported frame #${this.currentFrameIndex() + 1} PNG`);
    }
  }

  downloadClip(): void {
    const primary = this.primaryFile();
    if (!primary) return;
    triggerDownload(primary.downloadUrl, primary.fileName);
  }

  private restartDeckTimer(
    isPlaying: boolean,
    rate: number,
    totalFrames: number,
  ): void {
    this.stopDeckTimer();
    if (!isPlaying || totalFrames <= 1) return;
    const baseMs = Math.max(80, Math.round(this.videoMeta().durationMs / totalFrames));
    const intervalMs = Math.max(45, Math.round(baseMs / rate));
    this.deckTimer = setInterval(() => {
      const cur = this.currentFrameIndex();
      if (cur + 1 >= totalFrames) {
        if (this.loop()) {
          this.currentFrameIndex.set(0);
        } else {
          this.playing.set(false);
        }
      } else {
        this.currentFrameIndex.set(cur + 1);
      }
    }, intervalMs);
  }

  private stopDeckTimer(): void {
    if (this.deckTimer !== null) {
      clearInterval(this.deckTimer);
      this.deckTimer = null;
    }
  }
}
