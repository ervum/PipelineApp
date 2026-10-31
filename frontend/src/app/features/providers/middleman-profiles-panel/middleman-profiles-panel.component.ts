import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  CompilePreviewResult,
  MODALITIES,
  MODALITY_META,
  MiddlemanProfileModel,
  Modality,
  UpsertMiddlemanProfileDto,
  UpsertMiddlemanProfileSchema,
  defaultParamsFor,
} from '@forge/shared';
import { MiddlemanApi } from '../../../core/api/middleman.api';
import { ProviderStateService } from '../../../core/state/provider-state.service';
import { StudioStateService } from '../../../core/state/studio-state.service';
import { ToastService } from '../../../core/state/toast.service';
import { ButtonComponent } from '../../../ui/button/button.component';
import { ConfirmDialogService } from '../../../ui/confirm-dialog/confirm-dialog.service';
import { SelectComponent, SelectOption } from '../../../ui/select/select.component';
import { SliderComponent } from '../../../ui/slider/slider.component';
import { TierBadgeComponent } from '../../../ui/tier-badge/tier-badge.component';
import { ToggleComponent } from '../../../ui/toggle/toggle.component';
import { PromptDiffComponent } from '../../generators/middleman/prompt-diff/prompt-diff.component';

@Component({
  selector: 'fs-middleman-profiles-panel',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    SelectComponent,
    SliderComponent,
    TierBadgeComponent,
    ToggleComponent,
    PromptDiffComponent,
  ],
  templateUrl: './middleman-profiles-panel.component.html',
  styleUrl: './middleman-profiles-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiddlemanProfilesPanelComponent {
  readonly providerState = inject(ProviderStateService);
  readonly studio = inject(StudioStateService);
  private readonly middlemanApi = inject(MiddlemanApi);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  readonly selectedProfileId = signal<string | null>(null);
  readonly isCreating = signal(false);
  readonly saving = signal(false);
  readonly fieldErrors = signal<Record<string, string>>({});

  // Form fields
  readonly name = signal('');
  readonly providerConfigId = signal<string | null>(null);
  readonly model = signal('');
  readonly temperature = signal(0.4);
  readonly maxOutputTokens = signal(1600);
  readonly maxContextTokens = signal(12000);
  readonly supportsVision = signal(false);
  readonly attachReferenceImages = signal(false);
  readonly maxReferenceImages = signal(3);
  readonly jsonMode = signal(true);
  readonly isDefault = signal(false);
  readonly isVisionDefault = signal(false);

  // Test compile state
  readonly testModality = signal<Modality>('ICONS_2D');
  readonly testRawPrompt = signal(
    'A legendary plasma katana icon with neon cyan blade and dark titanium guard',
  );
  readonly testingCompile = signal(false);
  readonly testResult = signal<CompilePreviewResult | null>(null);

  readonly llmProviderOptions = computed<SelectOption<string>[]>(() =>
    this.providerState
      .providers()
      .filter((p) => p.roles.includes('LLM'))
      .map((p) => ({
        value: p.id,
        label: p.name,
        badge: p.tier,
        description: p.defaultModel ?? p.kind,
      })),
  );

  readonly modalityOptions: SelectOption<Modality>[] = MODALITIES.map((m) => ({
    value: m,
    label: MODALITY_META[m].label,
  }));

  readonly formatTemp = (v: number): string => v.toFixed(2);
  readonly formatInt = (v: number): string => `${Math.round(v)}`;

  constructor() {
    const first = this.providerState.profiles()[0];
    if (first) {
      this.selectProfile(first);
    }
  }

  selectProfile(profile: MiddlemanProfileModel): void {
    this.isCreating.set(false);
    this.selectedProfileId.set(profile.id);
    this.fieldErrors.set({});
    this.name.set(profile.name);
    this.providerConfigId.set(profile.providerConfigId);
    this.model.set(profile.model);
    this.temperature.set(profile.temperature);
    this.maxOutputTokens.set(profile.maxOutputTokens);
    this.maxContextTokens.set(profile.maxContextTokens);
    this.supportsVision.set(profile.supportsVision);
    this.attachReferenceImages.set(profile.attachReferenceImages);
    this.maxReferenceImages.set(profile.maxReferenceImages);
    this.jsonMode.set(profile.jsonMode);
    this.isDefault.set(profile.isDefault);
    this.isVisionDefault.set(profile.isVisionDefault);
  }

  startCreate(): void {
    const firstLlm = this.providerState.llmProviders()[0] ?? this.providerState.providers()[0];
    this.isCreating.set(true);
    this.selectedProfileId.set(null);
    this.fieldErrors.set({});
    this.name.set('New Middleman Profile');
    this.providerConfigId.set(firstLlm?.id ?? null);
    this.model.set(firstLlm?.defaultModel ?? 'gemini-3.8-flash');
    this.temperature.set(0.4);
    this.maxOutputTokens.set(1600);
    this.maxContextTokens.set(12000);
    this.supportsVision.set(true);
    this.attachReferenceImages.set(true);
    this.maxReferenceImages.set(3);
    this.jsonMode.set(true);
    this.isDefault.set(false);
    this.isVisionDefault.set(false);
  }

  onProviderChange(providerId: string | null): void {
    this.providerConfigId.set(providerId);
    if (!providerId) return;
    const found = this.providerState.providers().find((p) => p.id === providerId);
    if (found?.defaultModel) {
      this.model.set(found.defaultModel);
    }
  }

  async setDefaultProfile(profile: MiddlemanProfileModel, event: Event): Promise<void> {
    event.stopPropagation();
    await this.providerState.updateProfile(profile.id, { isDefault: true });
    this.toast.success(`"${profile.name}" set as default Middleman profile.`);
    if (this.selectedProfileId() === profile.id) {
      this.isDefault.set(true);
    }
  }

  async setVisionDefaultProfile(profile: MiddlemanProfileModel, event: Event): Promise<void> {
    event.stopPropagation();
    await this.providerState.updateProfile(profile.id, {
      supportsVision: true,
      isVisionDefault: true,
    });
    this.toast.success(`"${profile.name}" set as default Vision profile.`);
    if (this.selectedProfileId() === profile.id) {
      this.supportsVision.set(true);
      this.isVisionDefault.set(true);
    }
  }

  async save(): Promise<void> {
    this.fieldErrors.set({});
    const candidate: UpsertMiddlemanProfileDto = {
      name: this.name().trim(),
      providerConfigId: this.providerConfigId() ?? '',
      model: this.model().trim(),
      temperature: this.temperature(),
      maxOutputTokens: Math.round(this.maxOutputTokens()),
      maxContextTokens: Math.round(this.maxContextTokens()),
      supportsVision: this.supportsVision(),
      attachReferenceImages: this.attachReferenceImages(),
      maxReferenceImages: Math.round(this.maxReferenceImages()),
      jsonMode: this.jsonMode(),
      isDefault: this.isDefault(),
      isVisionDefault: this.isVisionDefault(),
    };

    const parsed = UpsertMiddlemanProfileSchema.safeParse(candidate);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'form';
        errs[key] = issue.message;
      }
      this.fieldErrors.set(errs);
      this.toast.error('Please fix the highlighted profile fields.');
      return;
    }

    this.saving.set(true);
    try {
      if (this.isCreating()) {
        const created = await this.providerState.createProfile(parsed.data);
        this.selectProfile(created);
        this.toast.success(`Created profile "${created.name}".`);
      } else if (this.selectedProfileId()) {
        const updated = await this.providerState.updateProfile(
          this.selectedProfileId()!,
          parsed.data,
        );
        this.selectProfile(updated);
        this.toast.success(`Updated profile "${updated.name}".`);
      }
    } finally {
      this.saving.set(false);
    }
  }

  async deleteSelected(): Promise<void> {
    const id = this.selectedProfileId();
    if (!id) return;
    const res = await this.confirm.confirm({
      title: 'Delete Middleman Profile',
      message: `Are you sure you want to delete "${this.name()}"?`,
      confirmLabel: 'Delete Profile',
      danger: true,
    });
    if (res !== 'confirm') return;

    await this.providerState.deleteProfile(id);
    this.toast.info('Middleman profile deleted.');
    const remaining = this.providerState.profiles()[0];
    if (remaining) {
      this.selectProfile(remaining);
    } else {
      this.startCreate();
    }
  }

  async runTestCompile(): Promise<void> {
    const projectId = this.studio.activeProjectId();
    if (!projectId) {
      this.toast.warn('Select an active project first to test Middleman compilation.');
      return;
    }
    const modality = this.testModality();
    const genProvider =
      this.providerState.defaultProviderFor(modality)() ??
      this.providerState.providers()[0];
    if (!genProvider) {
      this.toast.warn('No generator provider available for test compile.');
      return;
    }

    this.testingCompile.set(true);
    try {
      const result = await this.middlemanApi.compilePreview({
        projectId,
        modality,
        rawPrompt: this.testRawPrompt().trim() || 'Test asset prompt',
        pinnedFileIds: [],
        params: defaultParamsFor(modality),
        providerConfigId: genProvider.id,
        middlemanProfileId: this.selectedProfileId() ?? undefined,
      });
      this.testResult.set(result);
    } finally {
      this.testingCompile.set(false);
    }
  }
}
