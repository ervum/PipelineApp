import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ParamsFor, SEED_MAX, VoicesParamsSchema } from '@forge/shared';
import { VaultStateService } from '../../../../core/state/vault-state.service';
import { ButtonComponent } from '../../../../ui/button/button.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { SliderComponent } from '../../../../ui/slider/slider.component';

type LineType = ParamsFor<'VOICES'>['lineType'];
type EmotionTag = ParamsFor<'VOICES'>['emotionTags'][number];
type VoiceFormat = ParamsFor<'VOICES'>['outputFormat'];

const EMOTION_TAGS: ReadonlyArray<EmotionTag> = [
  'NEUTRAL',
  'ANGRY',
  'JOYFUL',
  'SAD',
  'FEARFUL',
  'WHISPER',
  'SHOUT',
  'SARCASTIC',
  'HEROIC',
  'MENACING',
  'TIRED',
  'PLAYFUL',
];

@Component({
  selector: 'fs-voices-params',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    ButtonComponent,
    SegmentedControlComponent,
    SelectComponent,
    SliderComponent,
  ],
  templateUrl: './voices-params.component.html',
  styleUrl: './voices-params.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoicesParamsComponent {
  readonly vault = inject(VaultStateService);

  readonly params = model.required<ParamsFor<'VOICES'>>();
  readonly seedLocked = signal(false);

  readonly allEmotions = EMOTION_TAGS;

  readonly lineTypeOptions: ReadonlyArray<SegmentedOption<LineType>> = [
    { value: 'DIALOGUE', label: 'Dialogue Line' },
    { value: 'BARK', label: 'Combat / NPC Bark' },
    { value: 'NARRATION', label: 'Narration / Lore' },
  ];

  readonly formatOptions: ReadonlyArray<SegmentedOption<VoiceFormat>> = [
    { value: 'wav', label: '.WAV' },
    { value: 'mp3', label: '.MP3' },
  ];

  readonly voiceProfileOptions = computed<SelectOption<string>[]>(() =>
    this.vault.voiceProfiles().map((vp) => ({
      value: vp.id,
      label: vp.name,
      badge: vp.characterSheetName ?? undefined,
      description: vp.description || vp.externalVoiceId,
    })),
  );

  readonly selectedVoiceProfile = computed(
    () =>
      this.vault
        .voiceProfiles()
        .find((vp) => vp.id === this.params().voiceProfileId) ?? null,
  );

  readonly wordCount = computed(() => {
    const t = this.params().transcript.trim();
    return t ? t.split(/\s+/).length : 0;
  });

  readonly formatSpeed = (v: number): string => `${v.toFixed(2)}×`;
  readonly formatPct = (v: number): string => `${Math.round(v * 100)}%`;
  readonly formatInt = (v: number): string => `${Math.round(v)}`;

  readonly errors = computed<Record<string, string>>(() => {
    const p = this.params();
    const out: Record<string, string> = {};
    if (!p.transcript.trim()) {
      out['transcript'] = 'Transcript is required for voice generation';
    }
    const res = VoicesParamsSchema.safeParse(p);
    if (!res.success) {
      for (const issue of res.error.issues) {
        out[issue.path.join('.') || 'root'] = issue.message;
      }
    }
    return out;
  });

  patch(partial: Partial<ParamsFor<'VOICES'>>): void {
    this.params.update((cur) => ({ ...cur, ...partial }));
  }

  onSelectVoiceProfile(voiceProfileId: string | null): void {
    const profile = this.vault
      .voiceProfiles()
      .find((vp) => vp.id === voiceProfileId);
    if (!profile) {
      this.patch({ voiceProfileId: null });
      return;
    }

    const ds = profile.defaultSettings ?? {};
    const nextPatch: Partial<ParamsFor<'VOICES'>> = {
      voiceProfileId: profile.id,
    };
    if (typeof ds['speed'] === 'number') nextPatch.speed = ds['speed'];
    if (typeof ds['stability'] === 'number') nextPatch.stability = ds['stability'];
    if (typeof ds['similarityBoost'] === 'number') {
      nextPatch.similarityBoost = ds['similarityBoost'];
    }
    if (typeof ds['style'] === 'number') nextPatch.style = ds['style'];
    if (Array.isArray(ds['emotionTags'])) {
      const validTags = (ds['emotionTags'] as string[]).filter((t): t is EmotionTag =>
        (EMOTION_TAGS as readonly string[]).includes(t),
      );
      if (validTags.length > 0) {
        nextPatch.emotionTags = validTags.slice(0, 4);
      }
    }
    this.patch(nextPatch);
  }

  hasEmotion(tag: EmotionTag): boolean {
    return this.params().emotionTags.includes(tag);
  }

  toggleEmotion(tag: EmotionTag): void {
    const cur = this.params().emotionTags;
    if (cur.includes(tag)) {
      const next = cur.filter((t) => t !== tag);
      this.patch({ emotionTags: next.length > 0 ? next : ['NEUTRAL'] });
    } else if (cur.length < 4) {
      this.patch({ emotionTags: [...cur, tag] });
    }
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
