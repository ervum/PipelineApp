import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { HealthState, JobStatus } from '@forge/shared';

const STATUS_LABELS: Record<string, string> = {
  QUEUED: 'Queued',
  COMPILING: 'Compiling',
  AWAITING_REVIEW: 'Review',
  READY: 'Ready',
  DISPATCHING: 'Dispatching',
  COLD_START: 'Cold Start',
  RUNNING: 'Running',
  INGESTING: 'Ingesting',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
  HEALTHY: 'Healthy',
  DEGRADED: 'Degraded',
  UNREACHABLE: 'Unreachable',
  UNAUTHORIZED: 'Unauthorized',
  UNKNOWN: 'Unknown',
};

@Component({
  selector: 'fs-status-pill',
  standalone: true,
  templateUrl: './status-pill.component.html',
  styleUrl: './status-pill.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StatusPillComponent {
  readonly status = input.required<JobStatus | HealthState | string>();
  readonly label = input<string | null>(null);

  readonly displayLabel = computed(
    () => this.label() ?? STATUS_LABELS[this.status()] ?? this.status(),
  );
}
