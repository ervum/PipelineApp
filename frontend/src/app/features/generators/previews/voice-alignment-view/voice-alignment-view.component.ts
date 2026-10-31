import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { AssetModel, VoiceAlignment } from '@forge/shared';
import { VaultStateService } from '../../../../core/state/vault-state.service';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { WaveformPlayerComponent } from '../waveform-player/waveform-player.component';

export interface PositionedWord {
  index: number;
  word: string;
  startMs: number;
  endMs: number;
  leftPct: number;
  widthPct: number;
}

@Component({
  selector: 'fs-voice-alignment-view',
  standalone: true,
  imports: [IconComponent, WaveformPlayerComponent],
  templateUrl: './voice-alignment-view.component.html',
  styleUrl: './voice-alignment-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoiceAlignmentViewComponent {
  private readonly vault = inject(VaultStateService);

  readonly asset = input.required<AssetModel>();
  readonly batchAssets = input<ReadonlyArray<AssetModel>>([]);
  readonly selectBatchAsset = output<AssetModel>();

  readonly player = viewChild(WaveformPlayerComponent);

  readonly voiceMeta = computed(() => {
    const m = this.asset().metadata;
    return m.modality === 'VOICES' ? m : null;
  });

  readonly voiceProfileName = computed(() => {
    const profileId = this.voiceMeta()?.voiceProfileId;
    if (!profileId) return 'Default Studio Voice';
    const found = this.vault.voiceProfiles().find((p) => p.id === profileId);
    return found?.name ?? 'Custom Voice Profile';
  });

  readonly words = computed<PositionedWord[]>(() => {
    const meta = this.voiceMeta();
    if (!meta) return [];
    const totalMs = Math.max(100, meta.durationMs || (this.player()?.duration() ?? 2) * 1000);
    const alignment: VoiceAlignment | null = meta.alignment;

    if (alignment && alignment.words.length > 0) {
      return alignment.words.map((w, idx) => {
        const leftPct = Math.max(0, Math.min(98, (w.startMs / totalMs) * 100));
        const spanPct = Math.max(2, Math.min(100 - leftPct, ((w.endMs - w.startMs) / totalMs) * 100));
        return {
          index: idx,
          word: w.word,
          startMs: w.startMs,
          endMs: w.endMs,
          leftPct,
          widthPct: spanPct,
        };
      });
    }

    // Fallback uniform distribution if alignment array is empty
    const tokens = (meta.transcript || this.asset().rawPrompt).trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) return [];
    const sliceMs = totalMs / tokens.length;
    return tokens.map((word, idx) => {
      const startMs = Math.round(idx * sliceMs);
      const endMs = Math.round((idx + 1) * sliceMs);
      return {
        index: idx,
        word,
        startMs,
        endMs,
        leftPct: (idx / tokens.length) * 100,
        widthPct: (1 / tokens.length) * 100,
      };
    });
  });

  readonly activeWordIndex = computed<number>(() => {
    const p = this.player();
    if (!p || !p.playing()) return -1;
    const curMs = p.currentTime() * 1000;
    const found = this.words().find((w) => curMs >= w.startMs && curMs <= w.endMs + 40);
    return found ? found.index : -1;
  });

  seekToWord(w: PositionedWord): void {
    const p = this.player();
    if (!p) return;
    p.playFrom(w.startMs / 1000);
  }
}
