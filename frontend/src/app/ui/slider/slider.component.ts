import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';

@Component({
  selector: 'fs-slider',
  standalone: true,
  templateUrl: './slider.component.html',
  styleUrl: './slider.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SliderComponent {
  readonly value = model<number>(0);
  readonly min = input<number>(0);
  readonly max = input<number>(100);
  readonly step = input<number>(1);
  readonly label = input<string>('');
  readonly disabled = input<boolean>(false);
  readonly format = input<(v: number) => string>((v) => String(v));

  readonly formattedValue = computed(() => this.format()(this.value()));

  onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    const num = Number(target.value);
    if (Number.isFinite(num)) {
      this.value.set(num);
    }
  }
}
