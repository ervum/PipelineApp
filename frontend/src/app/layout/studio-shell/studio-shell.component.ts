import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StudioStateService } from '../../core/state/studio-state.service';
import { ProjectFormModalComponent } from '../../features/vault/project-form-modal/project-form-modal.component';
import { ConfirmDialogComponent } from '../../ui/confirm-dialog/confirm-dialog.component';
import { ToastHostComponent } from '../../ui/toast-host/toast-host.component';
import { ContextBarComponent } from '../context-bar/context-bar.component';
import { SidebarComponent } from '../sidebar/sidebar.component';

@Component({
  selector: 'fs-studio-shell',
  standalone: true,
  imports: [
    RouterOutlet,
    SidebarComponent,
    ContextBarComponent,
    ToastHostComponent,
    ConfirmDialogComponent,
    ProjectFormModalComponent,
  ],
  templateUrl: './studio-shell.component.html',
  styleUrl: './studio-shell.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-collapsed]': 'studio.sidebarCollapsed()',
  },
})
export class StudioShellComponent {
  readonly studio = inject(StudioStateService);
}
