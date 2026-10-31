import {
  ChangeDetectionStrategy,
  Component,
  computed,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Icons2DParamsSchema, ParamsFor, SEED_MAX } from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';
import { SliderComponent } from '../../../../ui/slider/slider.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';

type IconCategory = ParamsFor<'ICONS_2D'>['iconCategory'];
type FrameShape = ParamsFor<'ICONS_2D'>['frameShape'];

@Component({
  selector: 'fs-icons-params',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    SegmentedControlComponent,
    SliderComponent,
    ToggleComponent,
  ],
  templateUrl: './icons-params.component.html',
  styleUrl: './icons-params.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconsParamsComponent {
  readonly params = model.required<ParamsFor<'ICONS_2D'>>();
  readonly seedLocked = signal(false);

  readonly categoryOptions: ReadonlyArray<SegmentedOption<IconCategory>> = [
    { value: 'ITEM', label: 'Item' },
    { value: 'SKILL', label: 'Skill' },
    { value: 'RANK_EMBLEM', label: 'Rank Emblem' },
    { value: 'UI_BUTTON', label: 'UI Button' },
  ];

  readonly frameShapes: ReadonlyArray<{ id: FrameShape; label: string }> = [
    { id: 'NONE', label: 'Die-Cut' },
    { id: 'CIRCLE', label: 'Circle' },
    { id: 'ROUNDED_SQUARE', label: 'Rounded' },
    { id: 'HEXAGON', label: 'Hexagon' },
    { id: 'SHIELD', label: 'Shield' },
    { id: 'DIAMOND', label: 'Diamond' },
  ];

  readonly sizeOptions: ReadonlyArray<SegmentedOption<512 | 1024>> = [
    { value: 512, label: '512 × 512' },
    { value: 1024, label: '1024 × 1024' },
  ];

  readonly formatInt = (v: number): string => `${Math.round(v)}`;

  readonly errors = computed<Record<string, string>>(() => {
    const res = Icons2DParamsSchema.safeParse(this.params());
    if (res.success) return {};
    const out: Record<string, string> = {};
    for (const issue of res.error.issues) {
      out[issue.path.join('.') || 'root'] = issue.message;
    }
    return out;
  });

  patch(partial: Partial<ParamsFor<'ICONS_2D'>>): void {
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
