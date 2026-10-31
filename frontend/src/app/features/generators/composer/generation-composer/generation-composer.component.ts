import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import {
  ExecutionMode,
  MODALITY_META,
  Modality,
  ModalityParams,
} from '@forge/shared';
import { ContextPreviewResponse, VaultApi } from '../../../../core/api/vault.api';
import { ProviderStateService } from '../../../../core/state/provider-state.service';
import { StudioStateService } from '../../../../core/state/studio-state.service';
import { VaultStateService } from '../../../../core/state/vault-state.service';
import { formatCost } from '../../../../core/utils/format';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { ProgressBarComponent } from '../../../../ui/progress-bar/progress-bar.component';
import { ExecutionModeToggleComponent } from '../execution-mode-toggle/execution-mode-toggle.component';
import { GoogleWebRunSettingsComponent } from '../google-web-run-settings/google-web-run-settings.component';
import { MiddlemanSelectorComponent } from '../middleman-selector/middleman-selector.component';
import { PromptInputComponent } from '../prompt-input/prompt-input.component';
import { ProviderSelectorComponent } from '../provider-selector/provider-selector.component';
import { VaultPinPickerComponent } from '../vault-pin-picker/vault-pin-picker.component';

@Component({
  selector: 'fs-generation-composer',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    ProgressBarComponent,
    PromptInputComponent,
    VaultPinPickerComponent,
    ProviderSelectorComponent,
    MiddlemanSelectorComponent,
    ExecutionModeToggleComponent,
    GoogleWebRunSettingsComponent,
  ],
  templateUrl: './generation-composer.component.html',
  styleUrl: './generation-composer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GenerationComposerComponent {
  readonly studio = inject(StudioStateService);
  readonly vault = inject(VaultStateService);
  readonly providerState = inject(ProviderStateService);
  private readonly vaultApi = inject(VaultApi);

  readonly modality = input.required<Modality>();
  readonly canSubmit = input<boolean>(false);
  readonly submitting = input<boolean>(false);

  readonly rawPrompt = model<string>('');
  readonly pinnedFileIds = model<string[]>([]);
  readonly params = model.required<ModalityParams>();
  readonly providerId = model<string | null>(null);
  readonly providerModel = model<string | null>(null);
  readonly middlemanProfileId = model<string | null>(null);
  readonly skipMiddleman = model<boolean>(false);
  readonly executionMode = model<ExecutionMode>('AUTO_FIRE');

  readonly generate = output<void>();
  readonly compileFirst = output<void>();

  readonly contextPreviewOpen = signal(false);
  readonly contextPreviewLoading = signal(false);
  readonly contextPreviewData = signal<ContextPreviewResponse | null>(null);

  readonly meta = computed(() => MODALITY_META[this.modality()]);

  readonly isGoogleWebProvider = computed(() => {
    const prov = this.providerState
      .providers()
      .find((p) => p.id === this.providerId());
    return prov?.kind === 'GOOGLE_WEB';
  });

  readonly contextFileCount = computed(() =>
    this.vault.contextCountFor(this.modality())(),
  );

  readonly batchCount = computed<number>(() => {
    const p = this.params();
    if ('batchCount' in p && typeof p.batchCount === 'number') {
      return p.batchCount;
    }
    if ('variationCount' in p && typeof p.variationCount === 'number') {
      return p.variationCount;
    }
    return 1;
  });

  readonly estimatedCostText = computed<string>(() => {
    const prov = this.providerState
      .providers()
      .find((p) => p.id === this.providerId());
    if (!prov) return '$0.0000';
    if (prov.tier === 'LOCAL') return '$0.0000 (Local)';
    const perReq = prov.settings.costPerRequestUsd ?? 0;
    const perSec = prov.settings.costPerSecondUsd ?? 0;
    const batch = this.batchCount();
    const est = (perReq > 0 ? perReq : perSec * 12) * batch;
    return `~${formatCost(est)}`;
  });

  readonly contextBudgetPct = computed<number>(() => {
    const data = this.contextPreviewData();
    if (!data || data.budget <= 0) return 0;
    return Math.min(100, Math.round((data.totalTokens / data.budget) * 100));
  });

  onPinFromMention(fileId: string): void {
    const cur = this.pinnedFileIds();
    if (!cur.includes(fileId) && cur.length < 12) {
      this.pinnedFileIds.set([...cur, fileId]);
    }
  }

  async toggleContextPreview(): Promise<void> {
    const next = !this.contextPreviewOpen();
    this.contextPreviewOpen.set(next);
    if (!next) return;

    const projectId = this.studio.activeProjectId();
    if (!projectId) return;

    this.contextPreviewLoading.set(true);
    try {
      const res = await this.vaultApi.contextPreview(projectId, {
        modality: this.modality(),
        pinned: this.pinnedFileIds(),
        rawPrompt: this.rawPrompt(),
      });
      this.contextPreviewData.set(res);
    } finally {
      this.contextPreviewLoading.set(false);
    }
  }
}
