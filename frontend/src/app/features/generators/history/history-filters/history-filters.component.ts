import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApprovalStatus, ExecutionTier } from '@forge/shared';
import { AssetGalleryFilters, AssetGalleryStore } from '../../../../core/state/asset-gallery.store';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';

type ApprovalFilterValue = ApprovalStatus | 'ALL';
type TierFilterValue = ExecutionTier | 'ALL';

@Component({
  selector: 'fs-history-filters',
  standalone: true,
  imports: [FormsModule, ButtonComponent, IconComponent, SegmentedControlComponent, SelectComponent],
  templateUrl: './history-filters.component.html',
  styleUrl: './history-filters.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryFiltersComponent {
  readonly gallery = inject(AssetGalleryStore);

  readonly approvalOptions: ReadonlyArray<SegmentedOption<ApprovalFilterValue>> = [
    { value: 'ALL', label: 'All' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'APPROVED', label: 'Approved' },
    { value: 'FINAL', label: 'Final' },
    { value: 'REJECTED', label: 'Rejected' },
  ];

  readonly tierOptions: ReadonlyArray<SelectOption<TierFilterValue>> = [
    { value: 'ALL', label: 'All Tiers' },
    { value: 'CLOUD_API', label: 'Cloud API' },
    { value: 'RUNPOD', label: 'RunPod GPU' },
    { value: 'LOCAL', label: 'Local / Demo' },
  ];

  readonly sortOptions: ReadonlyArray<SelectOption<AssetGalleryFilters['sort']>> = [
    { value: 'newest', label: 'Newest First' },
    { value: 'oldest', label: 'Oldest First' },
    { value: 'cost', label: 'Highest Cost' },
    { value: 'duration', label: 'Longest Duration' },
  ];

  readonly approvalValue = computed<ApprovalFilterValue>(
    () => this.gallery.filters().approval ?? 'ALL',
  );

  readonly tierValue = computed<TierFilterValue>(
    () => this.gallery.filters().tier ?? 'ALL',
  );

  onApprovalChange(val: ApprovalFilterValue): void {
    this.gallery.patchFilters({ approval: val === 'ALL' ? null : val });
  }

  onTierChange(val: TierFilterValue | null): void {
    this.gallery.patchFilters({ tier: !val || val === 'ALL' ? null : val });
  }

  onSortChange(val: AssetGalleryFilters['sort'] | null): void {
    if (val) {
      this.gallery.patchFilters({ sort: val });
    }
  }

  toggleFavorites(): void {
    this.gallery.patchFilters({ favorite: !this.gallery.filters().favorite });
  }

  onSearchChange(q: string): void {
    this.gallery.patchFilters({ q });
  }
}
