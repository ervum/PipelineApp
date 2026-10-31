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
  model,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { triggerDownload } from '../../../../core/utils/download';
import { formatSecondsClock } from '../../../../core/utils/format';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { AudioEngineService, PlaybackHandle } from '../../engines/audio-engine.service';
import { computePeaks } from '../../engines/waveform-peaks';
import { drawWaveform } from '../../engines/waveform-renderer';

export interface WaveformMarker {
  timeSec: number;
  label: string;
}

@Component({
  selector: 'fs-waveform-player',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  templateUrl: './waveform-player.component.html',
  styleUrl: './waveform-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class WaveformPlayerComponent {
  private readonly audioEngine = inject(AudioEngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly src = input.required<string | null>();
  readonly loop = model<boolean>(false);
  readonly height = input<number>(96);
  readonly accent = input<'cyan' | 'violet' | 'emerald' | 'amber'>('cyan');
  readonly markers = input<ReadonlyArray<WaveformMarker>>([]);
  readonly compact = input<boolean>(false);

  readonly containerRef = viewChild.required<ElementRef<HTMLDivElement>>('waveContainer');
  readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('waveCanvas');

  readonly loading = signal<boolean>(false);
  readonly error = signal<string | null>(null);
  readonly playing = signal<boolean>(false);
  readonly currentTime = signal<number>(0);
  readonly duration = signal<number>(0);
  readonly volume = signal<number>(0.9);
  readonly playheadX = signal<number>(0);
  readonly containerWidth = signal<number>(320);

  private audioBuffer: AudioBuffer | null = null;
  private peaks: Float32Array = new Float32Array(0);
  private handle: PlaybackHandle | null = null;
  private rafId: number | null = null;
  private resizeObserver: ResizeObserver | null = null;

  readonly timeReadout = computed(
    () => `${formatSecondsClock(this.currentTime())} / ${formatSecondsClock(this.duration())}`,
  );

  constructor() {
    afterNextRender(() => {
      const container = this.containerRef().nativeElement;
      this.containerWidth.set(Math.max(120, container.clientWidth));
      this.resizeObserver = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry) {
          this.containerWidth.set(Math.max(120, Math.floor(entry.contentRect.width)));
          this.renderCanvas();
        }
      });
      this.resizeObserver.observe(container);
    });

    effect(() => {
      const url = this.src();
      untracked(() => {
        this.stop();
        if (url) {
          void this.loadAudio(url);
        } else {
          this.audioBuffer = null;
          this.peaks = new Float32Array(0);
          this.duration.set(0);
          this.currentTime.set(0);
          this.playheadX.set(0);
          this.renderCanvas();
        }
      });
    });

    effect(() => {
      const loopVal = this.loop();
      this.handle?.setLoop(loopVal);
    });

    this.destroyRef.onDestroy(() => {
      this.stop();
      this.resizeObserver?.disconnect();
    });
  }

  private async loadAudio(url: string): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const buf = await this.audioEngine.decode(url);
      this.audioBuffer = buf;
      this.duration.set(buf.duration);
      this.currentTime.set(0);
      this.playheadX.set(0);
      this.peaks = await computePeaks(buf, 240);
      this.renderCanvas();
    } catch (err: unknown) {
      this.error.set(err instanceof Error ? err.message : 'Unable to decode audio');
    } finally {
      this.loading.set(false);
    }
  }

  togglePlay(): void {
    if (this.playing()) {
      this.pause();
    } else {
      this.playFrom(this.currentTime() >= this.duration() ? 0 : this.currentTime());
    }
  }

  playFrom(offsetSec: number): void {
    if (!this.audioBuffer) return;
    this.stopRaf();
    this.handle?.stop();
    this.playing.set(true);
    this.handle = this.audioEngine.play(this.audioBuffer, {
      offset: offsetSec,
      loop: this.loop(),
      gain: this.volume(),
      onEnded: () => {
        this.playing.set(false);
        this.stopRaf();
        this.currentTime.set(this.duration());
        this.updatePlayhead();
      },
    });
    this.startRaf();
  }

  pause(): void {
    if (!this.handle) return;
    const t = this.handle.currentTime();
    this.handle.stop();
    this.handle = null;
    this.playing.set(false);
    this.stopRaf();
    this.currentTime.set(t);
    this.updatePlayhead();
  }

  stop(): void {
    this.handle?.stop();
    this.handle = null;
    this.playing.set(false);
    this.stopRaf();
    this.currentTime.set(0);
    this.playheadX.set(0);
    this.renderCanvas();
  }

  toggleLoop(): void {
    this.loop.update((v) => !v);
  }

  onSeekClick(event: MouseEvent): void {
    if (!this.audioBuffer || this.duration() <= 0) return;
    const rect = this.containerRef().nativeElement.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const targetTime = ratio * this.duration();
    this.currentTime.set(targetTime);
    this.updatePlayhead();
    if (this.playing()) {
      this.playFrom(targetTime);
    }
  }

  onVolumeChange(event: Event): void {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v)) {
      this.volume.set(v);
      this.handle?.setGain(v);
    }
  }

  downloadAudio(): void {
    const url = this.src();
    if (url) {
      triggerDownload(url);
    }
  }

  private startRaf(): void {
    const step = (): void => {
      if (!this.playing() || !this.handle) return;
      this.currentTime.set(this.handle.currentTime());
      this.updatePlayhead();
      this.rafId = requestAnimationFrame(step);
    };
    this.rafId = requestAnimationFrame(step);
  }

  private stopRaf(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
  }

  private updatePlayhead(): void {
    const dur = this.duration();
    const w = this.containerWidth();
    const progress = dur > 0 ? this.currentTime() / dur : 0;
    this.playheadX.set(Math.round(progress * w));
    this.renderCanvas();
  }

  private renderCanvas(): void {
    const canvasEl = this.canvasRef()?.nativeElement;
    if (!canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    const dur = this.duration();
    const progress = dur > 0 ? this.currentTime() / dur : 0;
    drawWaveform(ctx, this.peaks, {
      width: this.containerWidth(),
      height: this.height(),
      progress,
    });
  }
}
