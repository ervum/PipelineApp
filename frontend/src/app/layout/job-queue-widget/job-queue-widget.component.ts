import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { JobModel } from '@forge/shared';
import { GeneratorJobStore } from '../../core/state/generator-job.store';
import { iconForModality } from '../../core/utils/file-kind';
import { NowService, routeForModality } from '../../core/utils/format';
import { IconComponent } from '../../ui/icon/icon.component';
import { ProgressAccent, ProgressBarComponent } from '../../ui/progress-bar/progress-bar.component';
import { StatusPillComponent } from '../../ui/status-pill/status-pill.component';
import { TierBadgeComponent } from '../../ui/tier-badge/tier-badge.component';

@Component({
  selector: 'fs-job-queue-widget',
  standalone: true,
  imports: [IconComponent, TierBadgeComponent, StatusPillComponent, ProgressBarComponent],
  templateUrl: './job-queue-widget.component.html',
  styleUrl: './job-queue-widget.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JobQueueWidgetComponent {
  readonly jobStore = inject(GeneratorJobStore);
  readonly nowService = inject(NowService);
  private readonly router = inject(Router);

  readonly visibleJobs = computed(() => this.jobStore.activeJobs().slice(0, 6));
  readonly summary = this.jobStore.queueSummary;

  modalityIcon(job: JobModel): string {
    return iconForModality(job.modality);
  }

  titleFor(job: JobModel): string {
    return job.edited?.assetTitle || job.compiled?.assetTitle || job.rawPrompt;
  }

  progressValue(job: JobModel): number | null {
    if (job.status === 'COMPILING' || job.status === 'COLD_START' || job.status === 'QUEUED') {
      return null;
    }
    return job.progressPercent;
  }

  progressAccent(job: JobModel): ProgressAccent {
    if (job.status === 'COMPILING') return 'cyan';
    if (job.status === 'COLD_START' || job.status === 'AWAITING_REVIEW') return 'amber';
    if (job.status === 'RUNNING' || job.status === 'INGESTING') return 'emerald';
    return 'violet';
  }

  elapsedFor(job: JobModel): string {
    const startTs = Date.parse(job.startedAt || job.createdAt);
    if (Number.isNaN(startTs)) return '0s';
    const sec = Math.max(0, Math.floor((this.nowService.now() - startTs) / 1000));
    return `${sec}s`;
  }

  openJob(job: JobModel): void {
    const route = routeForModality(job.modality);
    this.jobStore.focus(job.modality, job.id);
    void this.router.navigate(['/generate', route]);
  }

  cancelJob(job: JobModel, event: MouseEvent): void {
    event.stopPropagation();
    void this.jobStore.cancel(job.id);
  }
}
