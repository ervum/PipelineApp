import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { ProviderConfigModel } from '@forge/shared';
import { ProviderStateService } from '../../../core/state/provider-state.service';
import { ToastService } from '../../../core/state/toast.service';
import { formatRelativeTime } from '../../../core/utils/format';
import { ButtonComponent } from '../../../ui/button/button.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { StatusPillComponent } from '../../../ui/status-pill/status-pill.component';

@Component({
  selector: 'fs-health-indicator',
  standalone: true,
  imports: [ButtonComponent, IconComponent, StatusPillComponent],
  templateUrl: './health-indicator.component.html',
  styleUrl: './health-indicator.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HealthIndicatorComponent {
  private readonly providers = inject(ProviderStateService);
  private readonly toast = inject(ToastService);

  readonly provider = input.required<ProviderConfigModel>();
  readonly checking = signal<boolean>(false);

  readonly formatRelativeTime = formatRelativeTime;

  readonly workerStats = computed(() => {
    const msg = this.provider().health.message ?? '';
    const idleMatch = /idle[:=\s]+(\d+)/i.exec(msg);
    const runMatch = /running[:=\s]+(\d+)/i.exec(msg);
    const initMatch = /initializing[:=\s]+(\d+)/i.exec(msg);
    const throtMatch = /throttled[:=\s]+(\d+)/i.exec(msg);
    if (!idleMatch && !runMatch && !initMatch && !throtMatch) return null;
    return {
      idle: Number(idleMatch?.[1] ?? 0),
      running: Number(runMatch?.[1] ?? 0),
      initializing: Number(initMatch?.[1] ?? 0),
      throttled: Number(throtMatch?.[1] ?? 0),
    };
  });

  async runCheck(): Promise<void> {
    this.checking.set(true);
    try {
      const updated = await this.providers.checkHealth(this.provider().id);
      this.toast.info(`Health check: ${updated.health.state}`);
    } finally {
      this.checking.set(false);
    }
  }
}
