import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ButtonComponent } from '../button/button.component';
import { ModalComponent } from '../modal/modal.component';
import { ConfirmDialogService } from './confirm-dialog.service';

@Component({
  selector: 'fs-confirm-dialog',
  standalone: true,
  imports: [ModalComponent, ButtonComponent],
  templateUrl: './confirm-dialog.component.html',
  styleUrl: './confirm-dialog.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmDialogComponent {
  readonly dialogService = inject(ConfirmDialogService);
}
