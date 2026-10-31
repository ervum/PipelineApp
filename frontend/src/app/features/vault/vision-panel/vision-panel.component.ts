import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { VaultFileModel } from '@forge/shared';
import { ProviderStateService } from '../../../core/state/provider-state.service';
import { ToastService } from '../../../core/state/toast.service';
import { VaultStateService } from '../../../core/state/vault-state.service';
import { ButtonComponent } from '../../../ui/button/button.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { StatusPillComponent } from '../../../ui/status-pill/status-pill.component';

@Component({
  selector: 'fs-vision-panel',
  standalone: true,
  imports: [ButtonComponent, IconComponent, SelectComponent, StatusPillComponent],
  templateUrl: './vision-panel.component.html',
  styleUrl: './vision-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VisionPanelComponent {
  private readonly vault = inject(VaultStateService);
  private readonly providers = inject(ProviderStateService);
  private readonly toast = inject(ToastService);

  readonly file = input.required<VaultFileModel>();

  readonly selectedProfileId = signal<string | null>(null);
  readonly descriptorText = signal<string>('');
  readonly savingOverride = signal<boolean>(false);

  readonly visionProfileOptions = computed<SelectOption<string>[]>(() =>
    this.providers
      .profiles()
      .filter((p) => p.supportsVision)
      .map((p) => ({
        value: p.id,
        label: p.name,
        tier: p.tier,
        description: p.model,
      })),
  );

  readonly pillStatus = computed(() => {
    const s = this.file().visionStatus;
    if (s === 'DONE') return 'COMPLETED';
    if (s === 'RUNNING') return 'COMPILING';
    if (s === 'PENDING') return 'QUEUED';
    if (s === 'FAILED') return 'FAILED';
    return 'UNKNOWN';
  });

  constructor() {
    effect(() => {
      const f = this.file();
      untracked(() => {
        this.descriptorText.set(f.styleDescriptorText ?? '');
        if (!this.selectedProfileId()) {
          const defVision =
            this.providers.profiles().find((p) => p.isVisionDefault) ??
            this.providers.profiles().find((p) => p.supportsVision);
          this.selectedProfileId.set(defVision?.id ?? null);
        }
      });
    });
  }

  copyHex(hex: string): void {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(hex);
    }
    this.toast.info(`Copied ${hex}`);
  }

  async runAnalysis(): Promise<void> {
    await this.vault.analyzeVision(this.file().id, this.selectedProfileId() ?? undefined);
  }

  async saveDescriptorOverride(): Promise<void> {
    this.savingOverride.set(true);
    try {
      await this.vault.updateFileMetadata(this.file().id, {
        styleDescriptorText: this.descriptorText().trim() || null,
      });
      this.toast.success('Updated style descriptor override');
    } finally {
      this.savingOverride.set(false);
    }
  }
}
