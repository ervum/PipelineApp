import { ChangeDetectionStrategy, Component, input, model, output } from '@angular/core';
import { ButtonComponent } from '../button/button.component';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'fs-modal',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  templateUrl: './modal.component.html',
  styleUrl: './modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'onEscape()',
  },
})
export class ModalComponent {
  readonly open = model<boolean>(false);
  readonly size = input<'sm' | 'md' | 'lg' | 'xl'>('md');
  readonly title = input<string>('');
  readonly persistent = input<boolean>(false);
  readonly closed = output<void>();

  close(): void {
    if (!this.open()) return;
    this.open.set(false);
    this.closed.emit();
  }

  onBackdropClick(): void {
    if (!this.persistent()) {
      this.close();
    }
  }

  onEscape(): void {
    if (this.open() && !this.persistent()) {
      this.close();
    }
  }
}
