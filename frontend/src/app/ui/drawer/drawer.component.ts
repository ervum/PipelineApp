import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'fs-drawer',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  templateUrl: './drawer.component.html',
  styleUrl: './drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class DrawerComponent {
  readonly open = model<boolean>(false);
  readonly side = input<'right' | 'bottom'>('right');
  readonly title = input<string>('');
  readonly closed = output<void>();

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.closed.emit();
  }

  onEscape(): void {
    if (this.open()) {
      this.close();
    }
  }
}
