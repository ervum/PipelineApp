import {
  ChangeDetectionStrategy,
  Component,
  computed,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MusicParamsSchema, ParamsFor, SEED_MAX } from '@forge/shared';
import { formatSecondsClock } from '../../../../core/utils/format';
import { ButtonComponent } from '../../../../ui/button/button.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { SliderComponent } from '../../../../ui/slider/slider.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';

type TrackType = ParamsFor<'MUSIC'>['trackType'];
type AudioFormat = ParamsFor<'MUSIC'>['outputFormat'];

const KEY_SIGNATURES: ReadonlyArray<string> = [
  'C major', 'C minor',
  'C# major', 'C# minor',
  'D major', 'D minor',
  'Eb major', 'Eb minor',
  'E major', 'E minor',
  'F major', 'F minor',
  'F# major', 'F# minor',
  'G major', 'G minor',
  'Ab major', 'Ab minor',
  'A major', 'A minor',
  'Bb major', 'Bb minor',
  'B major', 'B minor',
];

@Component({
  selector: 'fs-music-params',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    SegmentedControlComponent,
    SelectComponent,
    SliderComponent,
    ToggleComponent,
  ],
  templateUrl: './music-params.component.html',
  styleUrl: './music-params.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MusicParamsComponent {
  readonly params = model.required<ParamsFor<'MUSIC'>>();
  readonly seedLocked = signal(false);

  private readonly tapTimestamps: number[] = [];

  readonly trackTypeOptions: ReadonlyArray<SelectOption<TrackType>> = [
    { value: 'BGM_LOOP', label: 'Exploration / Zone BGM Loop' },
    { value: 'COMBAT', label: 'Boss / Combat Encounter' },
    { value: 'AMBIENT', label: 'Ambient Soundscape' },
    { value: 'STINGER', label: 'Victory / Event Stinger' },
    { value: 'MENU', label: 'Main Menu / Lobby Theme' },
  ];

  readonly keyOptions: ReadonlyArray<SelectOption<string>> = [
    { value: '__AUTO__', label: 'Auto (Let Middleman Decide)' },
    ...KEY_SIGNATURES.map((k) => ({ value: k, label: k })),
  ];

  readonly formatOptions: ReadonlyArray<SegmentedOption<AudioFormat>> = [
    { value: 'wav', label: '.WAV (Lossless)' },
    { value: 'mp3', label: '.MP3' },
  ];

  readonly formatDuration = (sec: number): string =>
    `${formatSecondsClock(sec)} (${Math.round(sec)}s)`;

  readonly isBpmAuto = computed(() => this.params().bpm === null);

  readonly selectedKeyOption = computed(
    () => this.params().keySignature ?? '__AUTO__',
  );

  readonly errors = computed<Record<string, string>>(() => {
    const res = MusicParamsSchema.safeParse(this.params());
    if (res.success) return {};
    const out: Record<string, string> = {};
    for (const issue of res.error.issues) {
      out[issue.path.join('.') || 'root'] = issue.message;
    }
    return out;
  });

  patch(partial: Partial<ParamsFor<'MUSIC'>>): void {
    this.params.update((cur) => ({ ...cur, ...partial }));
  }

  onBpmAutoToggle(auto: boolean): void {
    this.patch({ bpm: auto ? null : 120 });
  }

  onBpmInput(val: number): void {
    if (!Number.isFinite(val)) return;
    this.patch({ bpm: Math.max(40, Math.min(220, Math.round(val))) });
  }

  tapTempo(): void {
    const now = performance.now();
    if (
      this.tapTimestamps.length > 0 &&
      now - (this.tapTimestamps[this.tapTimestamps.length - 1] ?? 0) > 2500
    ) {
      this.tapTimestamps.length = 0;
    }
    this.tapTimestamps.push(now);
    if (this.tapTimestamps.length > 5) {
      this.tapTimestamps.shift();
    }
    if (this.tapTimestamps.length >= 2) {
      const intervals: number[] = [];
      for (let i = 1; i < this.tapTimestamps.length; i++) {
        intervals.push(this.tapTimestamps[i]! - this.tapTimestamps[i - 1]!);
      }
      const lastFour = intervals.slice(-4);
      const avgMs =
        lastFour.reduce((sum, v) => sum + v, 0) / lastFour.length;
      const computedBpm = Math.max(
        40,
        Math.min(220, Math.round(60000 / avgMs)),
      );
      this.patch({ bpm: computedBpm });
    } else if (this.params().bpm === null) {
      this.patch({ bpm: 120 });
    }
  }

  onKeyChange(val: string | null): void {
    this.patch({
      keySignature: !val || val === '__AUTO__' ? null : val,
    });
  }

  rollSeed(): void {
    if (this.seedLocked()) return;
    this.patch({ seed: Math.floor(Math.random() * SEED_MAX) });
  }

  onSeedChange(raw: string): void {
    const trimmed = raw.trim();
    if (!trimmed) {
      this.patch({ seed: null });
      return;
    }
    const n = Number.parseInt(trimmed, 10);
    if (!Number.isNaN(n)) {
      this.patch({ seed: Math.max(0, Math.min(SEED_MAX, n)) });
    }
  }
}
