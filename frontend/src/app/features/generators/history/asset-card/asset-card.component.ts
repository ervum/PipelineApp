import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { AssetModel } from '@forge/shared';
import { iconForModality } from '../../../../core/utils/file-kind';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { TierBadgeComponent } from '../../../../ui/tier-badge/tier-badge.component';
import { WaveformPlayerComponent } from '../../previews/waveform-player/waveform-player.component';

@Component({
  selector: 'fs-asset-card',
  standalone: true,
  imports: [IconComponent, TierBadgeComponent, WaveformPlayerComponent],
  templateUrl: './asset-card.component.html',
  styleUrl: './asset-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetCardComponent {
  readonly asset = input.required<AssetModel>();
  readonly selected = input<boolean>(false);
  readonly comparing = input<boolean>(false);
  readonly listRow = input<boolean>(false);

  readonly selectAsset = output<AssetModel>();
  readonly toggleFavorite = output<AssetModel>();
  readonly toggleCompare = output<AssetModel>();
  readonly downloadAsset = output<AssetModel>();

  readonly glyph = computed(() => iconForModality(this.asset().modality));

  readonly formattedCost = computed(() => {
    const c = this.asset().costUsd;
    if (c === null || c === undefined) return '$0.00';
    return `$${c.toFixed(4)}`;
  });

  onFav(event: MouseEvent): void {
    event.stopPropagation();
    this.toggleFavorite.emit(this.asset());
  }

  onCompare(event: MouseEvent): void {
    event.stopPropagation();
    this.toggleCompare.emit(this.asset());
  }

  onDownload(event: MouseEvent): void {
    event.stopPropagation();
    this.downloadAsset.emit(this.asset());
  }
}
