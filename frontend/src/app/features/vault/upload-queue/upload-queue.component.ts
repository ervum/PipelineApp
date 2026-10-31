import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { VaultStateService } from '../../../core/state/vault-state.service';
import { ProgressBarComponent } from '../../../ui/progress-bar/progress-bar.component';

@Component({
  selector: 'fs-upload-queue',
  standalone: true,
  imports: [ProgressBarComponent],
  templateUrl: './upload-queue.component.html',
  styleUrl: './upload-queue.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UploadQueueComponent {
  readonly vault = inject(VaultStateService);
}
