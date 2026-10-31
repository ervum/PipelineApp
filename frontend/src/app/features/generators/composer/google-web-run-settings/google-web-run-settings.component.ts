import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
  untracked,
} from '@angular/core';
import {
  defaultGoogleWebRunSettingsForModel,
  findGoogleWebModel,
  getGoogleWebModelsForModality,
  GoogleWebModelDefinition,
  GoogleWebRunSettings,
  Modality,
  ModalityParams,
} from '@forge/shared';
import { ProviderStateService } from '../../../../core/state/provider-state.service';
import { ToastService } from '../../../../core/state/toast.service';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';

@Component({
  selector: 'fs-google-web-run-settings',
  standalone: true,
  imports: [ButtonComponent, IconComponent, ToggleComponent],
  templateUrl: './google-web-run-settings.component.html',
  styleUrl: './google-web-run-settings.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoogleWebRunSettingsComponent {
  readonly providerState = inject(ProviderStateService);
  private readonly toast = inject(ToastService);

  readonly modality = input.required<Modality>();
  readonly providerModel = model<string | null>(null);
  readonly params = model.required<ModalityParams>();

  readonly advancedOpen = signal<boolean>(true);
  readonly stopSequenceDraft = signal<string>('');

  readonly availableModels = computed<GoogleWebModelDefinition[]>(() =>
    getGoogleWebModelsForModality(this.modality()),
  );

  readonly guestModels = computed(() =>
    this.availableModels().filter((m) => m.authMode === 'gemini_guest'),
  );

  readonly geminiAuthModels = computed(() =>
    this.availableModels().filter((m) => m.authMode === 'gemini_auth'),
  );

  readonly aiStudioModels = computed(() =>
    this.availableModels().filter((m) => m.authMode === 'aistudio'),
  );

  readonly activeModelDef = computed<GoogleWebModelDefinition | null>(() => {
    const id = this.providerModel();
    const found = findGoogleWebModel(id);
    if (found && found.modalities.includes(this.modality())) {
      return found;
    }
    return this.availableModels()[0] ?? null;
  });

  readonly runSettings = computed<GoogleWebRunSettings>(() => {
    const p = this.params();
    const def = this.activeModelDef();
    const defaults = defaultGoogleWebRunSettingsForModel(def?.id);
    const current =
      'googleWebRunSettings' in p && p.googleWebRunSettings
        ? p.googleWebRunSettings
        : {};
    return {
      ...defaults,
      ...current,
    };
  });

  readonly hasToolsSection = computed<boolean>(() => {
    const spec = this.activeModelDef()?.parameters;
    if (!spec) return false;
    return Boolean(
      spec.supportsGroundingWithGoogleSearch ||
        spec.supportsImageSearch ||
        spec.supportsStructuredOutputs ||
        spec.supportsCodeExecution ||
        spec.supportsFunctionCalling ||
        spec.supportsAutoFunctionResponse ||
        spec.supportsUrlContext,
    );
  });

  readonly hasAdvancedSection = computed<boolean>(() => {
    const spec = this.activeModelDef()?.parameters;
    if (!spec) return false;
    return Boolean(spec.supportsStopSequence || spec.outputLength || spec.topP);
  });

  constructor() {
    effect(() => {
      const def = this.activeModelDef();
      const currentModelId = this.providerModel();
      untracked(() => {
        if (def && (!currentModelId || !findGoogleWebModel(currentModelId))) {
          this.providerModel.set(def.id);
        }
      });
    });
  }

  onModelSelect(modelId: string): void {
    this.providerModel.set(modelId);
    const defaults = defaultGoogleWebRunSettingsForModel(modelId);
    const cur = this.params();
    if ('googleWebRunSettings' in cur) {
      this.params.set({
        ...cur,
        googleWebRunSettings: defaults,
      } as ModalityParams);
    }
  }

  patchRunSetting<K extends keyof GoogleWebRunSettings>(
    key: K,
    value: GoogleWebRunSettings[K],
  ): void {
    const cur = this.params();
    const nextSettings: GoogleWebRunSettings = {
      ...this.runSettings(),
      [key]: value,
    };
    this.params.set({
      ...cur,
      googleWebRunSettings: nextSettings,
    } as ModalityParams);
  }

  resetDefaults(): void {
    const def = this.activeModelDef();
    if (!def) return;
    const defaults = defaultGoogleWebRunSettingsForModel(def.id);
    const cur = this.params();
    this.params.set({
      ...cur,
      googleWebRunSettings: defaults,
    } as ModalityParams);
    this.toast.info(`Reset Run Settings to ${def.label} defaults.`);
  }

  addStopSequence(): void {
    const draft = this.stopSequenceDraft().trim();
    if (!draft) return;
    const existing = this.runSettings().stopSequences ?? [];
    if (!existing.includes(draft)) {
      this.patchRunSetting('stopSequences', [...existing, draft]);
    }
    this.stopSequenceDraft.set('');
  }

  removeStopSequence(seq: string): void {
    const existing = this.runSettings().stopSequences ?? [];
    this.patchRunSetting(
      'stopSequences',
      existing.filter((s) => s !== seq),
    );
  }

  async toggleBrowser(): Promise<void> {
    const visible = await this.providerState.toggleBrowserVisibility();
    this.toast.info(
      visible
        ? 'Browser window is now visible on screen.'
        : 'Browser window hidden off-screen.',
    );
  }
}
