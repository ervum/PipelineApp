import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MODALITY_META, MODALITIES } from '@forge/shared';
import { GeneratorJobStore } from '../../core/state/generator-job.store';
import { ProviderStateService } from '../../core/state/provider-state.service';
import { StudioStateService } from '../../core/state/studio-state.service';
import { VaultStateService } from '../../core/state/vault-state.service';
import { ButtonComponent } from '../../ui/button/button.component';
import { IconComponent } from '../../ui/icon/icon.component';
import { JobQueueWidgetComponent } from '../job-queue-widget/job-queue-widget.component';
import { NavGroupComponent, NavItemConfig } from '../nav-group/nav-group.component';
import { ProjectSwitcherComponent } from '../project-switcher/project-switcher.component';

@Component({
  selector: 'fs-sidebar',
  standalone: true,
  imports: [
    IconComponent,
    ButtonComponent,
    ProjectSwitcherComponent,
    NavGroupComponent,
    JobQueueWidgetComponent,
  ],
  templateUrl: './sidebar.component.html',
  styleUrl: './sidebar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarComponent {
  readonly studio = inject(StudioStateService);
  readonly jobStore = inject(GeneratorJobStore);
  readonly vault = inject(VaultStateService);
  readonly providers = inject(ProviderStateService);

  readonly generatorNavItems = computed<NavItemConfig[]>(() => {
    const active = this.jobStore.activeJobs();
    return MODALITIES.map((m) => {
      const meta = MODALITY_META[m];
      const count = active.filter((j) => j.modality === m).length;
      return {
        label: meta.label,
        route: `/generate/${meta.route}`,
        icon: meta.icon.replace(/^icon-/, ''),
        count,
      };
    });
  });

  readonly knowledgeNavItems = computed<NavItemConfig[]>(() => [
    {
      label: 'Database (Vault)',
      route: '/vault',
      icon: 'database',
      spinnerBadge: this.vault.pendingVision() > 0,
    },
    {
      label: 'Providers & RunPod',
      route: '/providers',
      icon: 'plug',
      alertDot: this.providers.hasUnhealthyEnabledProvider(),
    },
    {
      label: 'MCP Server & AI Tools',
      route: '/mcp',
      icon: 'terminal',
    },
  ]);

  toggleCollapse(): void {
    this.studio.sidebarCollapsed.update((v) => !v);
  }
}
