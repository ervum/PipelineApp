import {
  ChangeDetectionStrategy,
  Component,
  computed,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Assets3DParamsSchema, ParamsFor, SEED_MAX } from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';
import { ReferenceSlotComponent } from '../../composer/reference-slot/reference-slot.component';

type SubMode3D = ParamsFor<'ASSETS_3D'>['subMode'];
type Category3D = ParamsFor<'ASSETS_3D'>['assetCategory'];
type PolyTier = ParamsFor<'ASSETS_3D'>['polycountTier'];
type TexRes = ParamsFor<'ASSETS_3D'>['textureResolution'];
type Format3D = ParamsFor<'ASSETS_3D'>['outputFormat'];
type Pose3D = ParamsFor<'ASSETS_3D'>['pose'];
type Topology3D = ParamsFor<'ASSETS_3D'>['topology'];

@Component({
  selector: 'fs-assets3d-params',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    SegmentedControlComponent,
    SelectComponent,
    ToggleComponent,
    ReferenceSlotComponent,
  ],
  templateUrl: './assets3d-params.component.html',
  styleUrl: './assets3d-params.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Assets3DParamsComponent {
  readonly params = model.required<ParamsFor<'ASSETS_3D'>>();
  readonly seedLocked = signal(false);

  readonly subModeOptions: ReadonlyArray<SegmentedOption<SubMode3D>> = [
    { value: 'TEXT_TO_3D', label: 'Text-to-3D', icon: 'file-text' },
    { value: 'IMAGE_TO_3D', label: 'Image-to-3D', icon: 'image' },
  ];

  readonly categoryOptions: ReadonlyArray<SelectOption<Category3D>> = [
    { value: 'PROP', label: 'Prop / Collectible' },
    { value: 'WEAPON', label: 'Weapon / Equipment' },
    { value: 'ENVIRONMENT', label: 'Environment / Architecture' },
    { value: 'CHARACTER_BASE', label: 'Character Base Mesh' },
  ];

  readonly polycountOptions: ReadonlyArray<SegmentedOption<PolyTier>> = [
    { value: 'LOW_POLY', label: 'Low-Poly Game Ready (~5k)' },
    { value: 'MID_POLY', label: 'Mid-Poly (~30k)' },
    { value: 'HIGH_RES', label: 'High-Res (~150k)' },
  ];

  readonly texResOptions: ReadonlyArray<SegmentedOption<TexRes>> = [
    { value: 1024, label: '1K (1024)' },
    { value: 2048, label: '2K (2048)' },
    { value: 4096, label: '4K (4096)' },
  ];

  readonly formatOptions: ReadonlyArray<SegmentedOption<Format3D>> = [
    { value: 'glb', label: '.GLB' },
    { value: 'fbx', label: '.FBX' },
    { value: 'obj', label: '.OBJ' },
  ];

  readonly poseOptions: ReadonlyArray<SegmentedOption<Pose3D>> = [
    { value: 'NONE', label: 'Natural' },
    { value: 'T_POSE', label: 'T-Pose' },
    { value: 'A_POSE', label: 'A-Pose' },
  ];

  readonly topologyOptions: ReadonlyArray<SegmentedOption<Topology3D>> = [
    { value: 'TRIANGLE', label: 'Triangle' },
    { value: 'QUAD', label: 'Quad-Dominant' },
  ];

  readonly errors = computed<Record<string, string>>(() => {
    const res = Assets3DParamsSchema.safeParse(this.params());
    if (res.success) return {};
    const out: Record<string, string> = {};
    for (const issue of res.error.issues) {
      out[issue.path.join('.') || 'root'] = issue.message;
    }
    return out;
  });

  patch(partial: Partial<ParamsFor<'ASSETS_3D'>>): void {
    this.params.update((cur) => ({ ...cur, ...partial }));
  }

  onCategoryChange(cat: Category3D | null): void {
    if (!cat) return;
    this.patch({
      assetCategory: cat,
      pose: cat === 'CHARACTER_BASE' ? this.params().pose : 'NONE',
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
