import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ai';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

@Component({
  selector: 'button[fsBtn], a[fsBtn]',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './button.component.html',
  styleUrl: './button.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class]': 'hostClasses()',
    '[attr.aria-busy]': 'loading() ? "true" : null',
  },
})
export class ButtonComponent {
  readonly variant = input<ButtonVariant>('secondary');
  readonly size = input<ButtonSize>('md');
  readonly loading = input<boolean>(false);
  readonly streaming = input<boolean>(false);
  readonly icon = input<string | null>(null);
  readonly iconOnly = input<boolean>(false);

  readonly hostClasses = computed(() => {
    const classes = ['fs-btn', `fs-btn--${this.variant()}`];
    const sz = this.size();
    if (sz === 'sm') classes.push('fs-btn--sm');
    if (sz === 'lg') classes.push('fs-btn--lg');
    if (sz === 'icon' || this.iconOnly()) classes.push('fs-btn--icon');
    if (this.loading()) classes.push('is-loading');
    if (this.streaming()) classes.push('is-streaming');
    return classes.join(' ');
  });
}
