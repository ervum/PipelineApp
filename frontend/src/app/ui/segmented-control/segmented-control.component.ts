import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export interface SegmentedOption<T = string> {
  value: T;
  label: string;
  icon?: string;
  disabled?: boolean;
}

@Component({
  selector: 'fs-segmented',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './segmented-control.component.html',
  styleUrl: './segmented-control.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SegmentedControlComponent<T = string> {
  readonly options = input.required<ReadonlyArray<SegmentedOption<T>>>();
  readonly value = model.required<T>();
  readonly ariaLabel = input<string>('Options');

  select(opt: SegmentedOption<T>): void {
    if (opt.disabled) return;
    this.value.set(opt.value);
  }
}
