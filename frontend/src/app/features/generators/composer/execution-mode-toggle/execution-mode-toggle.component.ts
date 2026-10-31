import { ChangeDetectionStrategy, Component, model } from '@angular/core';
import { ExecutionMode } from '@forge/shared';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';

@Component({
  selector: 'fs-execution-mode-toggle',
  standalone: true,
  imports: [SegmentedControlComponent],
  templateUrl: './execution-mode-toggle.component.html',
  styleUrl: './execution-mode-toggle.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExecutionModeToggleComponent {
  readonly mode = model<ExecutionMode>('AUTO_FIRE');

  readonly options: ReadonlyArray<SegmentedOption<ExecutionMode>> = [
    { value: 'AUTO_FIRE', label: 'Auto-Fire', icon: 'bolt' },
    { value: 'INTERCEPT', label: 'Intercept & Review', icon: 'eye' },
  ];
}
