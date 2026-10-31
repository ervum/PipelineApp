import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import {
  EXECUTION_TIERS,
  ExecutionTier,
  MODALITY_META,
  ProviderCatalogEntry,
  ProviderConfigModel,
} from '@forge/shared';
import { ProviderStateService } from '../../../core/state/provider-state.service';
import { iconForModality } from '../../../core/utils/file-kind';
import { ButtonComponent } from '../../../ui/button/button.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { ModalComponent } from '../../../ui/modal/modal.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../ui/segmented-control/segmented-control.component';
import { TierBadgeComponent } from '../../../ui/tier-badge/tier-badge.component';
import { ToggleComponent } from '../../../ui/toggle/toggle.component';

@Component({
  selector: 'fs-provider-list',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    ModalComponent,
    SegmentedControlComponent,
    TierBadgeComponent,
    ToggleComponent,
  ],
  templateUrl: './provider-list.component.html',
  styleUrl: './provider-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProviderListComponent {
  readonly state = inject(ProviderStateService);

  readonly selectProvider = output<string>();
  readonly createFromCatalog = output<ProviderCatalogEntry>();

  readonly tiers = EXECUTION_TIERS;
  readonly modalityMeta = MODALITY_META;
  readonly iconForModality = iconForModality;

  readonly catalogModalOpen = signal<boolean>(false);
  readonly catalogTierFilter = signal<'ALL' | ExecutionTier>('ALL');

  readonly tierFilterOptions: ReadonlyArray<SegmentedOption<'ALL' | ExecutionTier>> = [
    { value: 'ALL', label: 'All Tiers' },
    { value: 'CLOUD_API', label: 'Cloud API', icon: 'cloud' },
    { value: 'RUNPOD', label: 'RunPod GPU', icon: 'gpu' },
    { value: 'LOCAL', label: 'Local / Custom', icon: 'server' },
  ];

  readonly filteredCatalog = computed(() => {
    const tf = this.catalogTierFilter();
    return this.state.catalog().filter((c) => tf === 'ALL' || c.tier === tf);
  });

  onToggleEnabled(provider: ProviderConfigModel, enabled: boolean): void {
    void this.state.updateProvider(provider.id, { isEnabled: enabled });
  }

  pickCatalog(entry: ProviderCatalogEntry): void {
    this.catalogModalOpen.set(false);
    this.createFromCatalog.emit(entry);
  }
}
