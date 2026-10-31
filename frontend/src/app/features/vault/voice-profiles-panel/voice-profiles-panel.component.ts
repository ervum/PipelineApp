import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  output,
  signal,
} from '@angular/core';
import { VoiceProfileModel } from '@forge/shared';
import { ProviderStateService } from '../../../core/state/provider-state.service';
import { ToastService } from '../../../core/state/toast.service';
import { VaultStateService } from '../../../core/state/vault-state.service';
import { ButtonComponent } from '../../../ui/button/button.component';
import { ConfirmDialogService } from '../../../ui/confirm-dialog/confirm-dialog.service';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { SliderComponent } from '../../../ui/slider/slider.component';
import { WaveformPlayerComponent } from '../../generators/previews/waveform-player/waveform-player.component';

@Component({
  selector: 'fs-voice-profiles-panel',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    SelectComponent,
    SliderComponent,
    EmptyStateComponent,
    WaveformPlayerComponent,
  ],
  templateUrl: './voice-profiles-panel.component.html',
  styleUrl: './voice-profiles-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class VoiceProfilesPanelComponent {
  readonly vault = inject(VaultStateService);
  readonly providers = inject(ProviderStateService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  readonly openCharacterSheet = output<string>();

  readonly editingId = signal<string | null>(null);
  readonly isCreating = signal<boolean>(false);

  readonly name = signal<string>('');
  readonly characterSheetFileId = signal<string | null>(null);
  readonly providerConfigId = signal<string | null>(null);
  readonly externalVoiceId = signal<string>('');
  readonly description = signal<string>('');
  readonly speed = signal<number>(1.0);
  readonly stability = signal<number>(0.55);
  readonly similarityBoost = signal<number>(0.75);
  readonly style = signal<number>(0.3);
  readonly saving = signal<boolean>(false);

  readonly markdownFileOptions = computed<SelectOption<string>[]>(() =>
    this.vault
      .files()
      .filter((f) => f.kind === 'MARKDOWN')
      .map((f) => ({
        value: f.id,
        label: f.name,
        description: f.folderPath,
      })),
  );

  readonly voiceProviderOptions = computed<SelectOption<string>[]>(() =>
    this.providers
      .enabledForModality('VOICES')()
      .map((p) => ({
        value: p.id,
        label: p.name,
        tier: p.tier,
      })),
  );

  startCreate(): void {
    this.editingId.set(null);
    this.isCreating.set(true);
    this.name.set('');
    this.characterSheetFileId.set(null);
    this.providerConfigId.set(this.providers.defaultProviderFor('VOICES')()?.id ?? null);
    this.externalVoiceId.set('');
    this.description.set('');
    this.speed.set(1.0);
    this.stability.set(0.55);
    this.similarityBoost.set(0.75);
    this.style.set(0.3);
  }

  startEdit(vp: VoiceProfileModel): void {
    this.isCreating.set(false);
    this.editingId.set(vp.id);
    this.name.set(vp.name);
    this.characterSheetFileId.set(vp.characterSheetFileId);
    this.providerConfigId.set(vp.providerConfigId);
    this.externalVoiceId.set(vp.externalVoiceId);
    this.description.set(vp.description);
    const ds = vp.defaultSettings ?? {};
    this.speed.set(typeof ds['speed'] === 'number' ? ds['speed'] : 1.0);
    this.stability.set(typeof ds['stability'] === 'number' ? ds['stability'] : 0.55);
    this.similarityBoost.set(
      typeof ds['similarityBoost'] === 'number' ? ds['similarityBoost'] : 0.75,
    );
    this.style.set(typeof ds['style'] === 'number' ? ds['style'] : 0.3);
  }

  cancelForm(): void {
    this.isCreating.set(false);
    this.editingId.set(null);
  }

  async save(): Promise<void> {
    const cleanName = this.name().trim();
    if (!cleanName) {
      this.toast.warn('Character / Voice profile name is required');
      return;
    }
    this.saving.set(true);
    try {
      const dto = {
        name: cleanName,
        characterSheetFileId: this.characterSheetFileId(),
        providerConfigId: this.providerConfigId(),
        externalVoiceId: this.externalVoiceId().trim(),
        description: this.description().trim(),
        defaultSettings: {
          speed: this.speed(),
          stability: this.stability(),
          similarityBoost: this.similarityBoost(),
          style: this.style(),
        },
      };
      const editId = this.editingId();
      if (editId) {
        await this.vault.updateVoiceProfile(editId, dto);
        this.toast.success(`Updated voice profile "${cleanName}"`);
      } else {
        await this.vault.createVoiceProfile(dto);
        this.toast.success(`Created voice profile "${cleanName}"`);
      }
      this.cancelForm();
    } finally {
      this.saving.set(false);
    }
  }

  async remove(vp: VoiceProfileModel): Promise<void> {
    const res = await this.confirm.confirm({
      title: 'Delete Voice Profile',
      message: `Remove "${vp.name}" from this project's voice cast?`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (res === 'confirm') {
      await this.vault.deleteVoiceProfile(vp.id);
      if (this.editingId() === vp.id) {
        this.cancelForm();
      }
      this.toast.info(`Deleted voice profile "${vp.name}"`);
    }
  }
}
