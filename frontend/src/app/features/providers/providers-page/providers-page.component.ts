import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { Router } from '@angular/router';
import { ProviderCatalogEntry, ProviderConfigModel } from '@forge/shared';
import { ProviderStateService } from '../../../core/state/provider-state.service';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { TabOption, TabsComponent } from '../../../ui/tabs/tabs.component';
import { MiddlemanProfilesPanelComponent } from '../middleman-profiles-panel/middleman-profiles-panel.component';
import { MiddlemanTemplatesPanelComponent } from '../middleman-templates-panel/middleman-templates-panel.component';
import { ProviderEditorComponent } from '../provider-editor/provider-editor.component';
import { ProviderListComponent } from '../provider-list/provider-list.component';

export type ProvidersPageTab = 'providers' | 'profiles' | 'templates';

@Component({
  selector: 'fs-providers-page',
  standalone: true,
  imports: [
    TabsComponent,
    EmptyStateComponent,
    ProviderListComponent,
    ProviderEditorComponent,
    MiddlemanProfilesPanelComponent,
    MiddlemanTemplatesPanelComponent,
  ],
  templateUrl: './providers-page.component.html',
  styleUrl: './providers-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProvidersPageComponent {
  readonly state = inject(ProviderStateService);
  private readonly router = inject(Router);

  /** Route/query inputs bound via withComponentInputBinding() */
  readonly tab = input<string | undefined>(undefined);
  readonly providerId = input<string | undefined>(undefined);

  readonly activeTab = signal<ProvidersPageTab>('providers');
  readonly draftCatalogEntry = signal<ProviderCatalogEntry | null>(null);

  readonly topTabs: ReadonlyArray<TabOption> = [
    { id: 'providers', label: 'Providers & Endpoints', icon: 'server' },
    { id: 'profiles', label: 'Middleman Profiles', icon: 'sparkles' },
    { id: 'templates', label: 'Modality Templates', icon: 'file-code' },
  ];

  constructor() {
    effect(() => {
      const t = this.tab();
      untracked(() => {
        if (t === 'providers' || t === 'profiles' || t === 'templates') {
          this.activeTab.set(t);
        }
      });
    });

    effect(() => {
      const pid = this.providerId();
      untracked(() => {
        if (pid) {
          this.activeTab.set('providers');
          this.draftCatalogEntry.set(null);
          this.state.selectedProviderId.set(pid);
        }
      });
    });
  }

  onTabChange(tabId: string): void {
    const next = (
      tabId === 'profiles' || tabId === 'templates' ? tabId : 'providers'
    ) as ProvidersPageTab;
    this.activeTab.set(next);
    void this.router.navigate(['/providers'], {
      queryParams: { tab: next },
      replaceUrl: true,
    });
  }

  onSelectProvider(id: string): void {
    this.draftCatalogEntry.set(null);
    this.state.selectedProviderId.set(id);
    void this.router.navigate(['/providers', id], { replaceUrl: true });
  }

  onCreateFromCatalog(entry: ProviderCatalogEntry): void {
    this.draftCatalogEntry.set(entry);
  }

  onProviderSaved(saved: ProviderConfigModel): void {
    this.draftCatalogEntry.set(null);
    this.state.selectedProviderId.set(saved.id);
    void this.router.navigate(['/providers', saved.id], { replaceUrl: true });
  }

  onCancelDraft(): void {
    this.draftCatalogEntry.set(null);
  }
}
