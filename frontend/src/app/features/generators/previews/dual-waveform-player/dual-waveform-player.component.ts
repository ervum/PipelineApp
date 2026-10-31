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
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { AssetFileModel, AssetModel } from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { AudioEngineService, PlaybackHandle } from '../../engines/audio-engine.service';
import { computePeaks } from '../../engines/waveform-peaks';
import { drawWaveform } from '../../engines/waveform-renderer';
import { WaveformPlayerComponent } from '../waveform-player/waveform-player.component';

interface StemTrackState {
  file: AssetFileModel;
  label: string;
  muted: boolean;
  solo: boolean;
}

@Component({
  selector: 'fs-dual-waveform-player',
  standalone: true,
  imports: [ButtonComponent, IconComponent, WaveformPlayerComponent],
  templateUrl: './dual-waveform-player.component.html',
  styleUrl: './dual-waveform-player.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DualWaveformPlayerComponent {
  private readonly audioEngine = inject(AudioEngineService);
  private readonly destroyRef = inject(DestroyRef);

  readonly asset = input.required<AssetModel>();
  readonly compareAsset = input<AssetModel | null>(null);
  readonly clearCompare = output<void>();

  readonly seamCanvasRef = viewChild<ElementRef<HTMLCanvasElement>>('seamCanvas');

  readonly stems = signal<StemTrackState[]>([]);
  readonly stemsPlaying = signal(false);

  readonly seamPlaying = signal(false);
  readonly seamJumpDb = signal<number | null>(null);
  readonly seamWindowSec = signal<number>(2);

  private stemHandles = new Map<string, PlaybackHandle>();
  private seamBuffer: AudioBuffer | null = null;
  private seamPeaks: Float32Array = new Float32Array(0);
  private seamHandle: PlaybackHandle | null = null;
  private viewReady = false;

  readonly musicMeta = computed(() => {
    const m = this.asset().metadata;
    return m.modality === 'MUSIC' ? m : null;
  });

  readonly seamBadgeSeverity = computed<'emerald' | 'amber' | 'coral'>(() => {
    const db = this.seamJumpDb();
    if (db === null || db < 3) return 'emerald';
    if (db < 6) return 'amber';
    return 'coral';
  });

  constructor() {
    afterNextRender(() => {
      this.viewReady = true;
      this.renderSeamCanvas();
    });

    effect(() => {
      const a = this.asset();
      untracked(() => {
        this.stopStems();
        this.stopSeam();
        const stemFiles = a.files.filter((f) => f.role === 'STEM');
        this.stems.set(
          stemFiles.map((file) => ({
            file,
            label: file.fileName.replace(/\.[^.]+$/, '').toUpperCase(),
            muted: false,
            solo: false,
          })),
        );
        void this.prepareLoopSeam(a.primaryUrl);
      });
    });

    this.destroyRef.onDestroy(() => {
      this.stopStems();
      this.stopSeam();
    });
  }

  toggleStemMute(fileId: string): void {
    this.stems.update((list) =>
      list.map((s) => (s.file.id === fileId ? { ...s, muted: !s.muted } : s)),
    );
    this.syncStemGains();
  }

  toggleStemSolo(fileId: string): void {
    this.stems.update((list) =>
      list.map((s) => (s.file.id === fileId ? { ...s, solo: !s.solo } : s)),
    );
    this.syncStemGains();
  }

  async togglePlayStems(): Promise<void> {
    if (this.stemsPlaying()) {
      this.stopStems();
      return;
    }
    const list = this.stems();
    if (list.length === 0) return;

    this.stopSeam();
    try {
      const decoded = await Promise.all(
        list.map(async (s) => ({
          id: s.file.id,
          buffer: await this.audioEngine.decode(s.file.url),
        })),
      );
      this.stemHandles.clear();
      for (const item of decoded) {
        const handle = this.audioEngine.play(item.buffer, {
          loop: true,
          group: 'music-stems',
          gain: 1,
        });
        this.stemHandles.set(item.id, handle);
      }
      this.stemsPlaying.set(true);
      this.syncStemGains();
    } catch {
      this.stopStems();
    }
  }

  stopStems(): void {
    for (const h of this.stemHandles.values()) {
      h.stop();
    }
    this.stemHandles.clear();
    this.stemsPlaying.set(false);
  }

  toggleAuditionSeam(): void {
    if (this.seamPlaying()) {
      this.stopSeam();
      return;
    }
    if (!this.seamBuffer) return;
    this.stopStems();
    this.seamPlaying.set(true);
    this.seamHandle = this.audioEngine.play(this.seamBuffer, {
      loop: true,
      gain: 0.9,
      onEnded: () => this.seamPlaying.set(false),
    });
  }

  stopSeam(): void {
    this.seamHandle?.stop();
    this.seamHandle = null;
    this.seamPlaying.set(false);
  }

  private syncStemGains(): void {
    const list = this.stems();
    const anySolo = list.some((s) => s.solo);
    for (const s of list) {
      const handle = this.stemHandles.get(s.file.id);
      if (!handle) continue;
      const audible = anySolo ? s.solo && !s.muted : !s.muted;
      handle.setGain(audible ? 0.9 : 0);
    }
  }

  private async prepareLoopSeam(url: string): Promise<void> {
    try {
      const buf = await this.audioEngine.decode(url);
      const sr = buf.sampleRate;
      const halfSec = Math.min(2, buf.duration / 2);
      this.seamWindowSec.set(Number(halfSec.toFixed(1)));
      const halfSamples = Math.max(1, Math.floor(halfSec * sr));
      const totalSamples = halfSamples * 2;
      const channels = buf.numberOfChannels;

      const ctx = this.audioEngine.getContext();
      const joined = ctx.createBuffer(channels, totalSamples, sr);

      for (let ch = 0; ch < channels; ch++) {
        const srcData = buf.getChannelData(ch);
        const dstData = joined.getChannelData(ch);
        const tailStart = Math.max(0, srcData.length - halfSamples);
        for (let i = 0; i < halfSamples; i++) {
          dstData[i] = srcData[tailStart + i] ?? 0;
        }
        for (let i = 0; i < halfSamples; i++) {
          dstData[halfSamples + i] = srcData[i] ?? 0;
        }
      }

      // Compute RMS jump across 50ms window before & after seam
      const windowSamples = Math.min(halfSamples, Math.max(64, Math.floor(sr * 0.05)));
      const ch0 = joined.getChannelData(0);
      let sumBefore = 0;
      let sumAfter = 0;
      for (let i = 0; i < windowSamples; i++) {
        const b = ch0[halfSamples - 1 - i] ?? 0;
        const a = ch0[halfSamples + i] ?? 0;
        sumBefore += b * b;
        sumAfter += a * a;
      }
      const rmsBefore = Math.sqrt(sumBefore / windowSamples);
      const rmsAfter = Math.sqrt(sumAfter / windowSamples);
      const jumpDb = Math.abs(20 * Math.log10((rmsAfter + 1e-5) / (rmsBefore + 1e-5)));

      this.seamBuffer = joined;
      this.seamJumpDb.set(Number(jumpDb.toFixed(2)));
      this.seamPeaks = await computePeaks(joined, 160);
      this.renderSeamCanvas();
    } catch {
      this.seamBuffer = null;
      this.seamJumpDb.set(null);
    }
  }

  private renderSeamCanvas(): void {
    if (!this.viewReady) return;
    const canvas = this.seamCanvasRef()?.nativeElement;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const w = Math.max(240, canvas.parentElement?.clientWidth ?? 480);
    drawWaveform(ctx, this.seamPeaks, {
      width: w,
      height: 64,
      progress: 0.5,
    });
  }
}
