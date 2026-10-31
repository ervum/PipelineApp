import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { Modality } from '@forge/shared';
import { ProviderStateService } from '../../../../core/state/provider-state.service';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';

@Component({
  selector: 'fs-provider-selector',
  standalone: true,
  imports: [RouterLink, IconComponent, SelectComponent],
  templateUrl: './provider-selector.component.html',
  styleUrl: './provider-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProviderSelectorComponent {
  readonly providerState = inject(ProviderStateService);

  readonly modality = input.required<Modality>();
  readonly providerId = model<string | null>(null);
  readonly providerModel = model<string | null>(null);

  readonly availableProviders = computed(() =>
    this.providerState.enabledForModality(this.modality())(),
  );

  readonly providerOptions = computed<SelectOption<string>[]>(() => {
    const m = this.modality();
    return this.availableProviders().map((p) => ({
      value: p.id,
      label: p.name,
      tier: p.tier,
      health: p.health.state,
      badge: p.defaultForModalities.includes(m) ? 'Default' : undefined,
      description: p.defaultModel ?? p.kind,
    }));
  });

  readonly selectedProvider = computed(
    () => this.availableProviders().find((p) => p.id === this.providerId()) ?? null,
  );

  readonly modelOptions = computed<SelectOption<string>[]>(() => {
    const prov = this.selectedProvider();
    if (!prov) return [];
    const m = this.modality();
    const filtered = prov.models.filter(
      (opt) => opt.modalities.length === 0 || opt.modalities.includes(m),
    );
    if (filtered.length === 0 && prov.defaultModel) {
      return [{ value: prov.defaultModel, label: prov.defaultModel }];
    }
    return filtered.map((opt) => ({
      value: opt.id,
      label: opt.label,
      description: opt.notes,
    }));
  });

  readonly warningMessage = computed<string | null>(() => {
    const prov = this.selectedProvider();
    if (!prov) return null;
    const cat = this.providerState.catalog().find((c) => c.kind === prov.kind);
    if (cat?.requiresSecret && !prov.hasSecret) {
      return `Provider "${prov.name}" requires an API secret before dispatching jobs.`;
    }
    if (prov.health.state === 'UNAUTHORIZED' || prov.health.state === 'UNREACHABLE') {
      return `Provider "${prov.name}" reported ${prov.health.state}${prov.health.message ? `: ${prov.health.message}` : ''}.`;
    }
    return null;
  });

  onProviderChange(id: string | null): void {
    this.providerId.set(id);
    const prov = this.availableProviders().find((p) => p.id === id);
    if (prov) {
      const m = this.modality();
      const firstModel =
        prov.models.find((o) => o.modalities.includes(m))?.id ??
        prov.defaultModel ??
        prov.models[0]?.id ??
        null;
      this.providerModel.set(firstModel);
      void this.providerState.loadDescriptors(prov.id);
    } else {
      this.providerModel.set(null);
    }
  }
}
