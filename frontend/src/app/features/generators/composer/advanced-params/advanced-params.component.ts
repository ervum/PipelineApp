import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdapterDescriptor, ParamSpec } from '@forge/shared';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { SliderComponent } from '../../../../ui/slider/slider.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';

@Component({
  selector: 'fs-advanced-params',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    SelectComponent,
    SliderComponent,
    ToggleComponent,
  ],
  templateUrl: './advanced-params.component.html',
  styleUrl: './advanced-params.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdvancedParamsComponent {
  readonly descriptor = input<AdapterDescriptor | null>(null);
  readonly recommendedParams = input<Record<string, unknown> | null>(null);
  readonly overrides = model<Record<string, string | number | boolean>>({});

  readonly expanded = signal(false);

  readonly advancedSpecs = computed<ParamSpec[]>(() =>
    (this.descriptor()?.paramSpecs ?? []).filter((s) => s.advanced),
  );

  readonly activeOverrideCount = computed(
    () => Object.keys(this.overrides()).length,
  );

  numValue(spec: ParamSpec): number {
    const v = this.overrides()[spec.key] ?? spec.default;
    return typeof v === 'number' ? v : Number(v) || 0;
  }

  strValue(spec: ParamSpec): string {
    const v = this.overrides()[spec.key] ?? spec.default;
    return v === null || v === undefined ? '' : String(v);
  }

  boolValue(spec: ParamSpec): boolean {
    const v = this.overrides()[spec.key] ?? spec.default;
    return Boolean(v);
  }

  enumOptions(spec: ParamSpec): SelectOption<string>[] {
    return (spec.options ?? []).map((o) => ({
      value: o.value,
      label: o.label,
    }));
  }

  recommendedHint(spec: ParamSpec): string | number | boolean | null {
    const rec = this.recommendedParams()?.[spec.key];
    if (
      typeof rec === 'string' ||
      typeof rec === 'number' ||
      typeof rec === 'boolean'
    ) {
      return rec;
    }
    return null;
  }

  setParam(key: string, val: string | number | boolean | null): void {
    if (val === null) return;
    this.overrides.update((cur) => ({ ...cur, [key]: val }));
  }

  applyRecommended(spec: ParamSpec): void {
    const rec = this.recommendedHint(spec);
    if (rec !== null) {
      this.setParam(spec.key, rec);
    }
  }

  resetOverrides(): void {
    this.overrides.set({});
  }
}
