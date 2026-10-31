import {
  ChangeDetectionStrategy,
  Component,
  computed,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ParamsFor, SEED_MAX, SfxParamsSchema } from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { SliderComponent } from '../../../../ui/slider/slider.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';

type SfxCategory = ParamsFor<'SFX'>['sfxCategory'];
type SfxFormat = ParamsFor<'SFX'>['outputFormat'];

@Component({
  selector: 'fs-sfx-params',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    SegmentedControlComponent,
    SelectComponent,
    SliderComponent,
    ToggleComponent,
  ],
  templateUrl: './sfx-params.component.html',
  styleUrl: './sfx-params.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SfxParamsComponent {
  readonly params = model.required<ParamsFor<'SFX'>>();
  readonly seedLocked = signal(false);

  readonly categoryOptions: ReadonlyArray<SelectOption<SfxCategory>> = [
    { value: 'WEAPON_HIT', label: 'Weapon Swing / Hit' },
    { value: 'UI_CLICK', label: 'UI Click / Notification' },
    { value: 'FOOTSTEP', label: 'Footstep / Surface Foley' },
    { value: 'MAGIC', label: 'Arcane / Energy Spell' },
    { value: 'AMBIENT_FOLEY', label: 'Ambient Environmental Loop' },
    { value: 'EXPLOSION', label: 'Explosion / Detonation' },
    { value: 'CREATURE', label: 'Creature Vocalization' },
    { value: 'IMPACT', label: 'Heavy Physical Impact' },
  ];

  readonly formatOptions: ReadonlyArray<SegmentedOption<SfxFormat>> = [
    { value: 'wav', label: '.WAV' },
    { value: 'mp3', label: '.MP3' },
    { value: 'ogg', label: '.OGG' },
  ];

  readonly formatSec = (v: number): string => `${v.toFixed(1)}s`;
  readonly formatPct = (v: number): string => `${Math.round(v * 100)}%`;
  readonly formatInt = (v: number): string => `${Math.round(v)}`;

  readonly errors = computed<Record<string, string>>(() => {
    const res = SfxParamsSchema.safeParse(this.params());
    if (res.success) return {};
    const out: Record<string, string> = {};
    for (const issue of res.error.issues) {
      out[issue.path.join('.') || 'root'] = issue.message;
    }
    return out;
  });

  patch(partial: Partial<ParamsFor<'SFX'>>): void {
    this.params.update((cur) => ({ ...cur, ...partial }));
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
