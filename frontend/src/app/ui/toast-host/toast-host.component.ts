import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ToastService } from '../../core/state/toast.service';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'fs-toast-host',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './toast-host.component.html',
  styleUrl: './toast-host.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToastHostComponent {
  readonly toastService = inject(ToastService);

  iconFor(kind: string): string {
    switch (kind) {
      case 'success':
        return 'check';
      case 'warn':
        return 'warning';
      case 'error':
        return 'warning';
      default:
        return 'info';
    }
  }
}
