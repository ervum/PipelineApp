import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MODALITY_META } from '@forge/shared';
import { SocketService } from '../../core/realtime/socket.service';
import { ProviderStateService } from '../../core/state/provider-state.service';
import { StudioStateService } from '../../core/state/studio-state.service';
import { ToastService } from '../../core/state/toast.service';
import { VaultStateService } from '../../core/state/vault-state.service';
import { formatUsd } from '../../core/utils/format';
import { IconComponent } from '../../ui/icon/icon.component';
import { TierBadgeComponent } from '../../ui/tier-badge/tier-badge.component';

@Component({
  selector: 'fs-context-bar',
  standalone: true,
  imports: [IconComponent, TierBadgeComponent],
  templateUrl: './context-bar.component.html',
  styleUrl: './context-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextBarComponent {
  readonly studio = inject(StudioStateService);
  readonly vault = inject(VaultStateService);
  readonly providers = inject(ProviderStateService);
  readonly socket = inject(SocketService);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);

  readonly modalityMeta = computed(() => {
    const m = this.studio.activeModality();
    return m ? MODALITY_META[m] : null;
  });

  readonly contextCount = computed(() => {
    const m = this.studio.activeModality();
    if (!m) {
      return this.vault.files().length;
    }
    return this.vault.contextCountFor(m)();
  });

  readonly totalSpendFormatted = computed(() =>
    formatUsd(this.studio.activeProject()?.stats.totalCostUsd ?? 0, 4),
  );

  openVaultFilteredByScope(): void {
    const m = this.studio.activeModality();
    if (m) {
      this.vault.scopeFilter.set(m);
    }
    void this.router.navigate(['/vault']);
  }

  async toggleBrowserWindow(): Promise<void> {
    const visible = await this.providers.toggleBrowserVisibility();
    this.toast.info(
      visible
        ? 'Google Web / AI Studio browser window is now visible.'
        : 'Browser window hidden off-screen (headless).',
    );
  }

  async deleteLastRunChats(): Promise<void> {
    const count = await this.providers.deleteLastRunWebChats();
    this.toast.success(
      count > 0
        ? `Deleted ${count} tracked web chat(s) from the last run.`
        : 'No tracked web chats found for the last run.',
    );
  }
}
