import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { AssetModel, Modality } from '@forge/shared';
import { AssetGalleryStore } from '../../../../core/state/asset-gallery.store';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../../ui/empty-state/empty-state.component';
import { AssetCardComponent } from '../asset-card/asset-card.component';
import { AssetInspectorComponent, ReRunPayload } from '../asset-inspector/asset-inspector.component';
import { HistoryFiltersComponent } from '../history-filters/history-filters.component';

@Component({
  selector: 'fs-asset-history-drawer',
  standalone: true,
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    HistoryFiltersComponent,
    AssetCardComponent,
    AssetInspectorComponent,
  ],
  templateUrl: './asset-history-drawer.component.html',
  styleUrl: './asset-history-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AssetHistoryDrawerComponent {
  readonly gallery = inject(AssetGalleryStore);
  private readonly destroyRef = inject(DestroyRef);

  readonly modality = input.required<Modality>();
  readonly overlayMode = input<boolean>(false);
  readonly closeDrawer = output<void>();
  readonly reRunWithEdits = output<ReRunPayload>();

  readonly sentinelRef = viewChild<ElementRef<HTMLDivElement>>('scrollSentinel');
  readonly inspectorOpen = signal(true);

  private observer: IntersectionObserver | null = null;

  readonly isAudioModality = computed(() =>
    ['MUSIC', 'VOICES', 'SFX'].includes(this.modality()),
  );

  readonly formattedTotalCost = computed(() => `$${this.gallery.totalCost().toFixed(4)}`);

  constructor() {
    afterNextRender(() => {
      const el = this.sentinelRef()?.nativeElement;
      if (el && typeof IntersectionObserver !== 'undefined') {
        this.observer = new IntersectionObserver(
          (entries) => {
            if (entries[0]?.isIntersecting) {
              void this.gallery.loadMore();
            }
          },
          { rootMargin: '120px' },
        );
        this.observer.observe(el);
      }
    });

    this.destroyRef.onDestroy(() => {
      this.observer?.disconnect();
    });
  }

  onSelectAsset(asset: AssetModel): void {
    this.gallery.selectedAssetId.set(asset.id);
    this.inspectorOpen.set(true);
  }

  onToggleFavorite(asset: AssetModel): void {
    void this.gallery.toggleFavorite(asset.id);
  }

  onToggleCompare(asset: AssetModel): void {
    const cur = this.gallery.compareAssetId();
    this.gallery.compareAssetId.set(cur === asset.id ? null : asset.id);
  }

  onDownloadAsset(asset: AssetModel): void {
    const primary = asset.files.find((f) => f.role === 'PRIMARY') ?? asset.files[0];
    if (primary) {
      this.gallery.download(primary);
    }
  }
}
