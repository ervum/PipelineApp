import {
  ChangeDetectionStrategy,
  Component,
  computed,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ASPECT_DIMENSIONS,
  ImagesParamsSchema,
  ParamsFor,
  SEED_MAX,
} from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { SliderComponent } from '../../../../ui/slider/slider.component';
import { ReferenceSlotComponent } from '../../composer/reference-slot/reference-slot.component';

type ImageCategory = ParamsFor<'IMAGES'>['imageCategory'];
type AspectPreset = ParamsFor<'IMAGES'>['aspectPreset'];
type ReferenceMode = ParamsFor<'IMAGES'>['referenceMode'];

@Component({
  selector: 'fs-images-params',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    SelectComponent,
    SliderComponent,
    ReferenceSlotComponent,
  ],
  templateUrl: './images-params.component.html',
  styleUrl: './images-params.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ImagesParamsComponent {
  readonly params = model.required<ParamsFor<'IMAGES'>>();
  readonly seedLocked = signal(false);

  readonly categoryOptions: ReadonlyArray<SelectOption<ImageCategory>> = [
    { value: 'CONCEPT_ART', label: 'Concept Art' },
    { value: 'THUMBNAIL', label: 'Key Art / Game Thumbnail' },
    { value: 'PBR_TEXTURE', label: 'Tileable Surface / PBR Texture' },
    { value: 'BACKGROUND', label: 'Environment Background' },
    { value: 'SPLASH_ART', label: 'Character / Event Splash Art' },
  ];

  readonly aspectTiles: ReadonlyArray<{
    id: AspectPreset;
    label: string;
    dims: string;
    boxClass: string;
  }> = [
    {
      id: 'SQUARE_1_1',
      label: '1:1',
      dims: `${ASPECT_DIMENSIONS.SQUARE_1_1.width}×${ASPECT_DIMENSIONS.SQUARE_1_1.height}`,
      boxClass: 'ratio-1-1',
    },
    {
      id: 'THUMB_16_9',
      label: '16:9 Thumbnail',
      dims: `${ASPECT_DIMENSIONS.THUMB_16_9.width}×${ASPECT_DIMENSIONS.THUMB_16_9.height}`,
      boxClass: 'ratio-16-9',
    },
    {
      id: 'PORTRAIT_9_16',
      label: '9:16',
      dims: `${ASPECT_DIMENSIONS.PORTRAIT_9_16.width}×${ASPECT_DIMENSIONS.PORTRAIT_9_16.height}`,
      boxClass: 'ratio-9-16',
    },
    {
      id: 'SEAMLESS_TILE',
      label: 'Seamless Tile',
      dims: `${ASPECT_DIMENSIONS.SEAMLESS_TILE.width}×${ASPECT_DIMENSIONS.SEAMLESS_TILE.height}`,
      boxClass: 'ratio-tile',
    },
  ];

  readonly referenceModeOptions: ReadonlyArray<SelectOption<ReferenceMode>> = [
    { value: 'NONE', label: 'None (Text-to-Image)' },
    { value: 'IMG2IMG', label: 'Img2Img Guidance' },
    { value: 'CONTROLNET_CANNY', label: 'ControlNet Canny Edge' },
    { value: 'CONTROLNET_DEPTH', label: 'ControlNet Depth Map' },
    { value: 'STYLE_REFERENCE', label: 'Style Reference Transfer' },
  ];

  readonly formatPct = (v: number): string => `${Math.round(v * 100)}%`;
  readonly formatInt = (v: number): string => `${Math.round(v)}`;

  readonly errors = computed<Record<string, string>>(() => {
    const res = ImagesParamsSchema.safeParse(this.params());
    if (res.success) return {};
    const out: Record<string, string> = {};
    for (const issue of res.error.issues) {
      out[issue.path.join('.') || 'root'] = issue.message;
    }
    return out;
  });

  patch(partial: Partial<ParamsFor<'IMAGES'>>): void {
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
