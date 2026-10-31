import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { JobModel } from '@forge/shared';
import { MiddlemanStream, WorkerState } from '../../../../core/state/generator-job.store';
import { ProviderStateService } from '../../../../core/state/provider-state.service';
import { ToastService } from '../../../../core/state/toast.service';
import { NowService } from '../../../../core/utils/format';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';

@Component({
  selector: 'fs-middleman-status-pill',
  standalone: true,
  imports: [ButtonComponent, IconComponent],
  templateUrl: './middleman-status-pill.component.html',
  styleUrl: './middleman-status-pill.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiddlemanStatusPillComponent {
  private readonly nowService = inject(NowService);
  readonly providerState = inject(ProviderStateService);
  private readonly toast = inject(ToastService);

  readonly job = input.required<JobModel>();
  readonly stream = input<MiddlemanStream | null>(null);
  readonly workerState = input<WorkerState | null>(null);

  readonly openReview = output<void>();
  readonly retry = output<void>();

  readonly streamExpanded = signal(true);
  readonly streamBoxRef = viewChild<ElementRef<HTMLPreElement>>('streamBox');

  readonly streamTail = computed(() => {
    const text = this.stream()?.text ?? '';
    return text.length > 600 ? `…${text.slice(-600)}` : text;
  });

  readonly streamChars = computed(() => (this.stream()?.text ?? '').length);

  readonly elapsedSec = computed(() => {
    const j = this.job();
    const startTs =
      this.stream()?.startedAt ?? Date.parse(j.dispatchedAt || j.startedAt || j.createdAt);
    if (!startTs || Number.isNaN(startTs)) return 0;
    return Math.max(0, Math.floor((this.nowService.now() - startTs) / 1000));
  });

  readonly initializingWorkers = computed(() => {
    const ws = this.workerState();
    return ws?.workers?.initializing ?? 1;
  });

  readonly formattedDuration = computed(() => {
    const ms = this.job().executionMs;
    if (ms === null || ms === undefined) return '0.0s';
    return `${(ms / 1000).toFixed(1)}s`;
  });

  readonly formattedCost = computed(() => {
    const cost = this.job().costUsd;
    if (cost === null || cost === undefined) return '$0.0000';
    return `$${cost.toFixed(4)}`;
  });

  readonly isGoogleWebJob = computed(() => {
    const j = this.job();
    if (j.providerKind === 'GOOGLE_WEB') return true;
    const mmProfile = this.providerState
      .profiles()
      .find((p) => p.id === j.middlemanProfileId);
    if (!mmProfile) return false;
    const mmProv = this.providerState
      .providers()
      .find((p) => p.id === mmProfile.providerConfigId);
    return mmProv?.kind === 'GOOGLE_WEB';
  });

  async onAnswerNow(event: Event): Promise<void> {
    event.stopPropagation();
    const res = await this.providerState.triggerAnswerNow(this.job().id);
    if (res.clicked) {
      this.toast.success(res.message);
    } else {
      this.toast.info(res.message);
    }
  }

  async onToggleBrowser(event: Event): Promise<void> {
    event.stopPropagation();
    const visible = await this.providerState.toggleBrowserVisibility();
    this.toast.info(
      visible
        ? 'Browser window is now visible on screen.'
        : 'Browser window hidden off-screen.',
    );
  }

  async onDeleteJobChat(event: Event): Promise<void> {
    event.stopPropagation();
    const count = await this.providerState.deleteWebChatsForJob(this.job().id);
    this.toast.success(
      count > 0
        ? `Deleted ${count} web chat(s) created for this job.`
        : 'No active web chat found for this job.',
    );
  }

  async onDeleteLastRunChats(event: Event): Promise<void> {
    event.stopPropagation();
    const count = await this.providerState.deleteLastRunWebChats();
    this.toast.success(
      count > 0
        ? `Deleted ${count} web chat(s) from the last run.`
        : 'No tracked web chats found for the last run.',
    );
  }

  constructor() {
    effect(() => {
      // Trigger auto-scroll whenever streamTail changes
      const tail = this.streamTail();
      const box = this.streamBoxRef()?.nativeElement;
      if (tail && box) {
        queueMicrotask(() => {
          box.scrollTop = box.scrollHeight;
        });
      }
    });
  }

  toggleStream(): void {
    this.streamExpanded.update((v) => !v);
  }
}
