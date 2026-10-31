import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

@Component({
  selector: 'fs-icon',
  standalone: true,
  templateUrl: './icon.component.html',
  styleUrl: './icon.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.width.px]': 'size()',
    '[style.height.px]': 'size()',
    'aria-hidden': 'true',
  },
})
export class IconComponent {
  readonly name = input.required<string>();
  readonly size = input<number>(16);

  readonly href = computed(() => {
    const raw = this.name().replace(/^icon-/, '');
    return `assets/icons/sprite.svg#icon-${raw}`;
  });
}
