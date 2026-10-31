import { ChangeDetectionStrategy, Component, computed, input, output, signal } from '@angular/core';
import { AssetFileRole, AssetModel } from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';

type BgMode = 'checker' | 'dark' | 'light' | 'accent';
type ZoomMode = 'fit' | '100' | '200';

interface ResolutionVariant {
  size: 512 | 128 | 64 | 32;
  role: AssetFileRole;
  url: string;
  downloadUrl: string;
  pixelated: boolean;
}

@Component({
  selector: 'fs-icon-previewer',
  standalone: true,
  imports: [ButtonComponent, SegmentedControlComponent],
  templateUrl: './icon-previewer.component.html',
  styleUrl: './icon-previewer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconPreviewerComponent {
  readonly asset = input.required<AssetModel>();
  readonly batchAssets = input<ReadonlyArray<AssetModel>>([]);
  readonly selectBatchAsset = output<AssetModel>();

  readonly bgMode = signal<BgMode>('checker');
  readonly zoomMode = signal<ZoomMode>('fit');
  readonly silhouette = signal(false);

  readonly bgOptions: ReadonlyArray<SegmentedOption<BgMode>> = [
    { value: 'checker', label: 'Checker' },
    { value: 'dark', label: 'Dark' },
    { value: 'light', label: 'Light' },
    { value: 'accent', label: 'Accent' },
  ];

  readonly zoomOptions: ReadonlyArray<SegmentedOption<ZoomMode>> = [
    { value: 'fit', label: 'Fit' },
    { value: '100', label: '100%' },
    { value: '200', label: '200%' },
  ];

  readonly variants = computed<ResolutionVariant[]>(() => {
    const a = this.asset();
    const specs: Array<{ size: 512 | 128 | 64 | 32; role: AssetFileRole; pixelated: boolean }> = [
      { size: 512, role: 'VARIANT_512', pixelated: false },
      { size: 128, role: 'VARIANT_128', pixelated: false },
      { size: 64, role: 'VARIANT_64', pixelated: true },
      { size: 32, role: 'VARIANT_32', pixelated: true },
    ];
    return specs.map((s) => {
      const file = a.files.find((f) => f.role === s.role);
      return {
        size: s.size,
        role: s.role,
        url: file?.url ?? a.primaryUrl,
        downloadUrl: file?.downloadUrl ?? a.primaryUrl,
        pixelated: s.pixelated,
      };
    });
  });

  readonly slot64Url = computed(() => {
    const v64 = this.variants().find((v) => v.size === 64);
    return v64?.url ?? this.asset().primaryUrl;
  });
}
