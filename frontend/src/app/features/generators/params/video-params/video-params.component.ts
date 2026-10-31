import {
  ChangeDetectionStrategy,
  Component,
  computed,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  ParamsFor,
  SEED_MAX,
  VIDEO_ASPECT_DIMENSIONS,
  VideoParamsSchema,
} from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { SliderComponent } from '../../../../ui/slider/slider.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';
import { ReferenceSlotComponent } from '../../composer/reference-slot/reference-slot.component';

type VideoSubMode = ParamsFor<'VIDEO'>['subMode'];
type VideoCategory = ParamsFor<'VIDEO'>['videoCategory'];
type VideoAspectRatio = ParamsFor<'VIDEO'>['aspectRatio'];
type VideoResolution = ParamsFor<'VIDEO'>['resolution'];
type VideoFps = ParamsFor<'VIDEO'>['fps'];
type VideoCameraMotion = ParamsFor<'VIDEO'>['cameraMotion'];
type VideoMemoryStrategy = ParamsFor<'VIDEO'>['memoryStrategy'];

@Component({
  selector: 'fs-video-params',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    SegmentedControlComponent,
    SelectComponent,
    SliderComponent,
    ToggleComponent,
    ReferenceSlotComponent,
  ],
  templateUrl: './video-params.component.html',
  styleUrl: './video-params.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VideoParamsComponent {
  readonly params = model.required<ParamsFor<'VIDEO'>>();
  readonly seedLocked = signal(false);

  readonly subModeOptions: ReadonlyArray<SegmentedOption<VideoSubMode>> = [
    { value: 'TEXT_TO_VIDEO', label: 'Text-to-Video' },
    { value: 'IMAGE_TO_VIDEO', label: 'Image-to-Video' },
  ];

  readonly categoryOptions: ReadonlyArray<SelectOption<VideoCategory>> = [
    { value: 'CUTSCENE', label: 'Cinematic Cutscene Shot' },
    { value: 'VFX_LOOP', label: 'Seamless VFX / Elemental Loop' },
    { value: 'CHARACTER_TURNTABLE', label: 'Character 360° Turntable' },
    { value: 'ENVIRONMENT_PAN', label: 'Environment Establishing Pan' },
    { value: 'TRAILER_SHOT', label: 'Hero Action Trailer Shot' },
    { value: 'UI_ANIMATION', label: 'Animated HUD / Menu Backdrop' },
  ];

  readonly resolutionOptions: ReadonlyArray<SegmentedOption<VideoResolution>> = [
    { value: '720p', label: '720p HD' },
    { value: '1080p', label: '1080p Full HD' },
  ];

  readonly fpsOptions: ReadonlyArray<SegmentedOption<VideoFps>> = [
    { value: 24, label: '24 fps' },
    { value: 30, label: '30 fps' },
    { value: 60, label: '60 fps' },
  ];

  readonly aspectTiles = computed<
    ReadonlyArray<{ id: VideoAspectRatio; label: string; dims: string }>
  >(() => {
    const res = this.params().resolution;
    const scale = res === '720p' ? 2 / 3 : 1;
    const fmt = (ratio: VideoAspectRatio) => {
      const base = VIDEO_ASPECT_DIMENSIONS[ratio];
      return `${Math.round(base.width * scale)}×${Math.round(base.height * scale)}`;
    };
    return [
      { id: '16:9', label: '16:9 Widescreen', dims: fmt('16:9') },
      { id: '1:1', label: '1:1 Square', dims: fmt('1:1') },
      { id: '9:16', label: '9:16 Vertical', dims: fmt('9:16') },
      { id: '21:9', label: '21:9 Cinema', dims: fmt('21:9') },
    ];
  });

  readonly cameraMotionOptions: ReadonlyArray<SelectOption<VideoCameraMotion>> = [
    { value: 'STATIC', label: 'Static (Locked Tripod)' },
    { value: 'PAN_LEFT', label: 'Pan Left' },
    { value: 'PAN_RIGHT', label: 'Pan Right' },
    { value: 'TILT_UP', label: 'Tilt Up' },
    { value: 'TILT_DOWN', label: 'Tilt Down' },
    { value: 'ZOOM_IN', label: 'Slow Dolly Zoom In' },
    { value: 'ZOOM_OUT', label: 'Pull-Back Zoom Out' },
    { value: 'ORBIT', label: '360° Orbital Sweep' },
    { value: 'DOLLY_TRACK', label: 'Lateral Tracking Dolly' },
  ];

  readonly memoryStrategyOptions: ReadonlyArray<SelectOption<VideoMemoryStrategy>> = [
    {
      value: 'RAM_FALLBACK_32GB',
      label: '32GB DDR5 System RAM Fallback (CPU Offload + Pinned Host RAM)',
    },
    { value: 'LOW_VRAM_TILED', label: 'Low-VRAM Tiled VAE + Temporal Slicing' },
    { value: 'AUTO', label: 'Auto Hardware Policy' },
    { value: 'VRAM_ONLY', label: 'Strict Dedicated GPU VRAM Only' },
  ];

  readonly formatFloat = (v: number): string => v.toFixed(2);
  readonly formatSec = (v: number): string => `${Math.round(v)}s`;

  readonly errors = computed<Record<string, string>>(() => {
    const res = VideoParamsSchema.safeParse(this.params());
    if (res.success) return {};
    const out: Record<string, string> = {};
    for (const issue of res.error.issues) {
      out[issue.path.join('.') || 'root'] = issue.message;
    }
    return out;
  });

  patch(partial: Partial<ParamsFor<'VIDEO'>>): void {
    this.params.update((cur) => ({ ...cur, ...partial }));
  }

  onSubModeChange(subMode: VideoSubMode): void {
    this.patch({
      subMode,
      referenceStorageKey:
        subMode === 'TEXT_TO_VIDEO' ? null : this.params().referenceStorageKey,
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
