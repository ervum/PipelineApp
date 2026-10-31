import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  MODALITIES,
  MODALITY_META,
  MiddlemanTemplateModel,
  Modality,
  UpsertMiddlemanTemplateSchema,
  estimateTokens,
} from '@forge/shared';
import { ProviderStateService } from '../../../core/state/provider-state.service';
import { StudioStateService } from '../../../core/state/studio-state.service';
import { ToastService } from '../../../core/state/toast.service';
import { formatRelative } from '../../../core/utils/format';
import { ButtonComponent } from '../../../ui/button/button.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { SegmentedControlComponent, SegmentedOption } from '../../../ui/segmented-control/segmented-control.component';

@Component({
  selector: 'fs-middleman-templates-panel',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    SegmentedControlComponent,
  ],
  templateUrl: './middleman-templates-panel.component.html',
  styleUrl: './middleman-templates-panel.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MiddlemanTemplatesPanelComponent {
  readonly providerState = inject(ProviderStateService);
  readonly studio = inject(StudioStateService);
  private readonly toast = inject(ToastService);

  readonly modalities = MODALITIES;
  readonly modalityMeta = MODALITY_META;

  readonly selectedModality = signal<Modality>('ICONS_2D');
  readonly scopeMode = signal<'global' | 'project'>('global');
  readonly selectedTemplateId = signal<string | null>(null);
  readonly saving = signal(false);

  // Editor form fields
  readonly name = signal('');
  readonly systemTemplate = signal('');
  readonly defaultNegativePrompt = signal('');
  readonly hardConstraints = signal('');
  readonly fieldErrors = signal<Record<string, string>>({});

  readonly scopeOptions = computed<SegmentedOption<'global' | 'project'>[]>(() => {
    const projName = this.studio.activeProject()?.name ?? 'Active Project';
    return [
      { value: 'global', label: 'Global Blueprint' },
      { value: 'project', label: `Project Override (${projName})` },
    ];
  });

  readonly modalityTemplates = computed(() => {
    const m = this.selectedModality();
    return this.providerState
      .templates()
      .filter((t) => t.modality === m)
      .sort((a, b) => b.version - a.version);
  });

  readonly globalVersions = computed(() =>
    this.modalityTemplates().filter((t) => t.projectId === null),
  );

  readonly projectVersions = computed(() => {
    const pid = this.studio.activeProjectId();
    if (!pid) return [];
    return this.modalityTemplates().filter((t) => t.projectId === pid);
  });

  readonly activeGlobalTemplate = computed(
    () => this.globalVersions().find((t) => t.isActive) ?? this.globalVersions()[0] ?? null,
  );

  readonly activeProjectTemplate = computed(
    () => this.projectVersions().find((t) => t.isActive) ?? this.projectVersions()[0] ?? null,
  );

  readonly visibleVersions = computed(() =>
    this.scopeMode() === 'global' ? this.globalVersions() : this.projectVersions(),
  );

  readonly tokenEstimateCount = computed(() => estimateTokens(this.systemTemplate()));

  readonly formatRelative = formatRelative;

  constructor() {
    effect(() => {
      const m = this.selectedModality();
      const scope = this.scopeMode();
      const list = this.providerState.templates();
      untracked(() => {
        if (list.length === 0) return;
        const target =
          scope === 'project'
            ? this.activeProjectTemplate() ?? this.activeGlobalTemplate()
            : this.activeGlobalTemplate();
        if (target && target.modality === m) {
          this.loadIntoEditor(target);
        }
      });
    });
  }

  selectModality(m: Modality): void {
    this.selectedModality.set(m);
  }

  loadIntoEditor(tpl: MiddlemanTemplateModel): void {
    this.selectedTemplateId.set(tpl.id);
    this.fieldErrors.set({});
    this.name.set(tpl.name);
    this.systemTemplate.set(tpl.systemTemplate);
    this.defaultNegativePrompt.set(tpl.defaultNegativePrompt);
    this.hardConstraints.set(tpl.hardConstraints);
  }

  async saveNewVersion(asProjectOverride = false): Promise<void> {
    this.fieldErrors.set({});
    const projectId =
      asProjectOverride || this.scopeMode() === 'project'
        ? this.studio.activeProjectId()
        : null;

    if ((asProjectOverride || this.scopeMode() === 'project') && !projectId) {
      this.toast.warn('Select an active project before creating a project override.');
      return;
    }

    const parsed = UpsertMiddlemanTemplateSchema.safeParse({
      projectId,
      modality: this.selectedModality(),
      name: this.name().trim(),
      systemTemplate: this.systemTemplate(),
      defaultNegativePrompt: this.defaultNegativePrompt(),
      hardConstraints: this.hardConstraints(),
    });

    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path.join('.') || 'form';
        errs[key] = issue.message;
      }
      this.fieldErrors.set(errs);
      this.toast.error('Template validation failed. Check required fields.');
      return;
    }

    this.saving.set(true);
    try {
      const created = await this.providerState.saveTemplateVersion(parsed.data);
      if (asProjectOverride) {
        this.scopeMode.set('project');
      }
      this.loadIntoEditor(created);
      this.toast.success(
        `Saved ${created.projectId ? 'project override' : 'global'} v${created.version} for ${MODALITY_META[created.modality].label}.`,
      );
    } finally {
      this.saving.set(false);
    }
  }

  async activateVersion(tpl: MiddlemanTemplateModel, event: Event): Promise<void> {
    event.stopPropagation();
    const activated = await this.providerState.activateTemplate(tpl.id);
    this.loadIntoEditor(activated);
    this.toast.success(`Activated v${activated.version} (${activated.name}).`);
  }
}
