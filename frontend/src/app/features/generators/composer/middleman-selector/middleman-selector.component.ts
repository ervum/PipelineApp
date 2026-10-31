import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  model,
} from '@angular/core';
import { ProviderStateService } from '../../../../core/state/provider-state.service';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';

const BYPASS_VALUE = '__BYPASS__';

@Component({
  selector: 'fs-middleman-selector',
  standalone: true,
  imports: [SelectComponent],
  templateUrl: './middleman-selector.component.html',
  styleUrl: './middleman-selector.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiddlemanSelectorComponent {
  readonly providerState = inject(ProviderStateService);

  readonly profileId = model<string | null>(null);
  readonly skipMiddleman = model<boolean>(false);

  readonly options = computed<SelectOption<string>[]>(() => {
    const profileOpts: SelectOption<string>[] = this.providerState
      .profiles()
      .map((p) => ({
        value: p.id,
        label: p.name,
        tier: p.tier,
        badge: p.supportsVision ? 'Vision' : undefined,
        description: `${p.providerName} · ${p.model}`,
      }));

    return [
      ...profileOpts,
      {
        value: BYPASS_VALUE,
        label: 'Bypass Middleman (Raw Prompt Direct)',
        description: 'Send raw prompt directly to generator without vault expansion',
      },
    ];
  });

  readonly selectedValue = computed<string | null>(() => {
    if (this.skipMiddleman()) return BYPASS_VALUE;
    return this.profileId() ?? this.providerState.defaultProfile()?.id ?? null;
  });

  onChange(val: string | null): void {
    if (val === BYPASS_VALUE) {
      this.skipMiddleman.set(true);
    } else {
      this.skipMiddleman.set(false);
      this.profileId.set(val);
    }
  }
}
