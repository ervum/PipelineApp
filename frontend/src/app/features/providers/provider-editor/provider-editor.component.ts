import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import {
  ASSET_FILE_ROLES,
  ExecutionTier,
  GOOGLE_WEB_MODEL_CATALOG,
  GoogleWebAuthMode,
  MODALITIES,
  MODALITY_META,
  ModelOption,
  Modality,
  OutputMapping,
  PROVIDER_ROLES,
  ProviderCatalogEntry,
  ProviderConfigModel,
  ProviderKind,
  ProviderRole,
  ProviderSettings,
  RunPodOutputAssetMapping,
  TEMPLATE_VARIABLES,
  UpsertProviderSchema,
  selectPath,
} from '@forge/shared';
import { ProviderStateService } from '../../../core/state/provider-state.service';
import { ToastService } from '../../../core/state/toast.service';
import { ButtonComponent } from '../../../ui/button/button.component';
import { ConfirmDialogService } from '../../../ui/confirm-dialog/confirm-dialog.service';
import { IconComponent } from '../../../ui/icon/icon.component';
import { JsonEditorComponent } from '../../../ui/json-editor/json-editor.component';
import { TabOption, TabsComponent } from '../../../ui/tabs/tabs.component';
import { TierBadgeComponent } from '../../../ui/tier-badge/tier-badge.component';
import { ToggleComponent } from '../../../ui/toggle/toggle.component';
import { HealthIndicatorComponent } from '../health-indicator/health-indicator.component';
import { RunPodTemplateEditorComponent } from '../runpod-template-editor/runpod-template-editor.component';

@Component({
  selector: 'fs-provider-editor',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    TabsComponent,
    TierBadgeComponent,
    ToggleComponent,
    JsonEditorComponent,
    RunPodTemplateEditorComponent,
    HealthIndicatorComponent,
  ],
  templateUrl: './provider-editor.component.html',
  styleUrl: './provider-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProviderEditorComponent {
  readonly state = inject(ProviderStateService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmDialogService);

  readonly provider = input<ProviderConfigModel | null>(null);
  readonly draftCatalogEntry = input<ProviderCatalogEntry | null>(null);
  readonly saved = output<ProviderConfigModel>();
  readonly cancelledDraft = output<void>();

  readonly workflowEditor = viewChild<JsonEditorComponent>('workflowEditor');

  readonly activeTab = signal<string>('connection');
  readonly saving = signal<boolean>(false);
  readonly validationErrors = signal<string[]>([]);

  readonly name = signal<string>('');
  readonly kind = signal<ProviderKind>('OPENAI');
  readonly tier = signal<ExecutionTier>('CLOUD_API');
  readonly roles = signal<ProviderRole[]>(['GENERATOR']);
  readonly modalities = signal<Modality[]>(['ICONS_2D']);
  readonly defaultForModalities = signal<Modality[]>([]);
  readonly isEnabled = signal<boolean>(true);
  readonly baseUrl = signal<string>('');
  readonly runpodEndpointId = signal<string>('');

  readonly secretMode = signal<'keep' | 'replace' | 'clear'>('keep');
  readonly secretDraft = signal<string>('');

  readonly extraHeaders = signal<Array<{ key: string; value: string }>>([]);
  readonly models = signal<ModelOption[]>([]);
  readonly defaultModel = signal<string>('');

  readonly payloadTemplateText = signal<string>('{\n}');
  readonly workflowTemplateText = signal<string>('{\n}');

  readonly assetMappings = signal<RunPodOutputAssetMapping[]>([
    { path: 'output.images[*]', encoding: 'base64', mimeType: 'image/png', role: 'PRIMARY' },
  ]);
  readonly progressPath = signal<string>('output.progress');
  readonly errorPath = signal<string>('error');
  readonly metadataPath = signal<string>('output.meta');
  readonly sampleOutputJson = signal<string>(
    JSON.stringify(
      {
        id: 'sync-job-99',
        status: 'COMPLETED',
        output: {
          images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
          meta: { seed: 42 },
        },
      },
      null,
      2,
    ),
  );

  readonly settings = signal<ProviderSettings>({
    timeoutMs: 120_000,
    pollIntervalMs: 2000,
    maxPollIntervalMs: 15_000,
    maxConcurrency: 2,
    costPerSecondUsd: 0.00044,
    costPerRequestUsd: 0,
    executionTimeoutMs: 600_000,
    ttlMs: 86_400_000,
    useWebhook: false,
  });

  readonly allRoles = PROVIDER_ROLES;
  readonly allModalities = MODALITIES;
  readonly modalityMeta = MODALITY_META;
  readonly allFileRoles = ASSET_FILE_ROLES;
  readonly templateVars = TEMPLATE_VARIABLES;

  readonly catalogEntry = computed(() =>
    this.state.catalog().find((c) => c.kind === this.kind()) ?? null,
  );

  readonly tabs = computed<TabOption[]>(() => {
    const k = this.kind();
    const isRunpodOrGeneric = k === 'RUNPOD_SERVERLESS' || k === 'GENERIC_HTTP';
    const isComfy = k === 'COMFYUI';
    const list: TabOption[] = [
      { id: 'connection', label: 'Connection', icon: 'plug' },
      { id: 'models', label: 'Models', icon: 'layers', badge: this.models().length },
    ];
    if (isRunpodOrGeneric) {
      list.push({ id: 'payload', label: 'Payload Template', icon: 'file-json' });
      list.push({ id: 'mapping', label: 'Output Mapping', icon: 'settings' });
    }
    if (isComfy) {
      list.push({ id: 'workflow', label: 'Workflow (ComfyUI)', icon: 'file-json' });
    }
    list.push({ id: 'advanced', label: 'Advanced', icon: 'settings' });
    if (this.provider()) {
      list.push({ id: 'health', label: 'Health', icon: 'bolt' });
    }
    return list;
  });

  readonly outputMappingTestResults = computed(() => {
    try {
      const sample: unknown = JSON.parse(this.sampleOutputJson());
      return this.assetMappings().map((m) => {
        const matches = selectPath(sample, m.path);
        const previews = matches.map((val) => {
          const str = typeof val === 'string' ? val : JSON.stringify(val);
          return str.length > 72 ? `${str.slice(0, 72)}… (${str.length} chars)` : str;
        });
        return { path: m.path, role: m.role, encoding: m.encoding, count: matches.length, previews };
      });
    } catch (err: unknown) {
      return [
        {
          path: 'JSON Error',
          role: 'PRIMARY' as const,
          encoding: 'text' as const,
          count: 0,
          previews: [err instanceof Error ? err.message : 'Invalid sample JSON'],
        },
      ];
    }
  });

  readonly workflowHasEnhancedPrompt = computed(() =>
    /\{\{\s*enhanced_prompt\s*\}\}/.test(this.workflowTemplateText()),
  );

  constructor() {
    effect(() => {
      const p = this.provider();
      const draftCat = this.draftCatalogEntry();
      untracked(() => {
        this.validationErrors.set([]);
        this.activeTab.set('connection');
        if (p) {
          this.loadFromProvider(p);
        } else if (draftCat) {
          this.loadFromCatalog(draftCat);
        }
      });
    });
  }

  private loadFromProvider(p: ProviderConfigModel): void {
    this.name.set(p.name);
    this.kind.set(p.kind);
    this.tier.set(p.tier);
    this.roles.set([...p.roles]);
    this.modalities.set([...p.modalities]);
    this.defaultForModalities.set([...p.defaultForModalities]);
    this.isEnabled.set(p.isEnabled);
    this.baseUrl.set(p.baseUrl ?? '');
    this.runpodEndpointId.set(p.runpodEndpointId ?? '');
    this.secretMode.set(p.hasSecret ? 'keep' : 'replace');
    this.secretDraft.set('');
    this.extraHeaders.set(
      Object.entries(p.extraHeaders ?? {}).map(([key, value]) => ({ key, value })),
    );
    this.models.set(p.models.map((m) => ({ ...m, modalities: [...m.modalities], roles: [...m.roles] })));
    this.defaultModel.set(p.defaultModel ?? '');
    this.payloadTemplateText.set(
      JSON.stringify(
        p.payloadTemplate ?? {
          input: {
            prompt: '{{enhanced_prompt}}',
            negative_prompt: '{{negative_prompt}}',
            seed: '{{seed}}',
          },
        },
        null,
        2,
      ),
    );
    this.workflowTemplateText.set(
      JSON.stringify(
        p.workflowTemplate ?? {
          '3': { inputs: { seed: '{{seed}}', steps: '{{steps}}' }, class_type: 'KSampler' },
          '6': { inputs: { text: '{{enhanced_prompt}}' }, class_type: 'CLIPTextEncode' },
        },
        null,
        2,
      ),
    );
    if (p.outputMapping) {
      this.assetMappings.set(p.outputMapping.assets.map((a) => ({ ...a })));
      this.progressPath.set(p.outputMapping.progressPath ?? '');
      this.errorPath.set(p.outputMapping.errorPath ?? '');
      this.metadataPath.set(p.outputMapping.metadataPath ?? '');
    }
    this.settings.set({
      timeoutMs: p.settings.timeoutMs ?? 120_000,
      pollIntervalMs: p.settings.pollIntervalMs ?? 2000,
      maxPollIntervalMs: p.settings.maxPollIntervalMs ?? 15_000,
      maxConcurrency: p.settings.maxConcurrency ?? 2,
      costPerSecondUsd: p.settings.costPerSecondUsd ?? 0,
      costPerRequestUsd: p.settings.costPerRequestUsd ?? 0,
      executionTimeoutMs: p.settings.executionTimeoutMs ?? 600_000,
      ttlMs: p.settings.ttlMs ?? 86_400_000,
      useWebhook: p.settings.useWebhook ?? false,
      path: p.settings.path,
      supportsJsonMode: p.settings.supportsJsonMode,
      webAuthMode: p.settings.webAuthMode,
      browserHeadless: p.settings.browserHeadless ?? true,
      autoDeleteCreatedChats: p.settings.autoDeleteCreatedChats ?? false,
    });
    if (p.kind === 'GOOGLE_WEB') {
      void this.state.refreshGoogleWebStatus();
    }
  }

  private loadFromCatalog(cat: ProviderCatalogEntry): void {
    this.name.set(cat.label);
    this.kind.set(cat.kind);
    this.tier.set(cat.tier);
    this.roles.set([...cat.roles]);
    this.modalities.set([...cat.modalities]);
    this.defaultForModalities.set([]);
    this.isEnabled.set(true);
    this.baseUrl.set(cat.defaultBaseUrl ?? '');
    this.runpodEndpointId.set(cat.kind === 'RUNPOD_SERVERLESS' ? 'ep01customgpu' : '');
    this.secretMode.set('replace');
    this.secretDraft.set('');
    this.extraHeaders.set([]);
    this.models.set(cat.suggestedModels.map((m) => ({ ...m })));
    this.defaultModel.set(cat.suggestedModels[0]?.id ?? '');
    this.payloadTemplateText.set(
      JSON.stringify(
        {
          input: {
            prompt: '{{enhanced_prompt}}',
            negative_prompt: '{{negative_prompt}}',
            width: '{{width}}',
            height: '{{height}}',
            seed: '{{seed}}',
          },
        },
        null,
        2,
      ),
    );
    this.workflowTemplateText.set(
      JSON.stringify(
        {
          '6': { inputs: { text: '{{enhanced_prompt}}' }, class_type: 'CLIPTextEncode' },
        },
        null,
        2,
      ),
    );
    this.assetMappings.set([
      { path: 'output.images[*]', encoding: 'base64', mimeType: 'image/png', role: 'PRIMARY' },
    ]);
  }

  toggleRole(role: ProviderRole): void {
    const cur = this.roles();
    if (cur.includes(role)) {
      if (cur.length > 1) {
        this.roles.set(cur.filter((r) => r !== role));
      }
    } else {
      this.roles.set([...cur, role]);
    }
  }

  toggleModality(mod: Modality): void {
    const cur = this.modalities();
    if (cur.includes(mod)) {
      this.modalities.set(cur.filter((m) => m !== mod));
      this.defaultForModalities.update((d) => d.filter((m) => m !== mod));
    } else {
      this.modalities.set([...cur, mod]);
    }
  }

  toggleDefaultModality(mod: Modality): void {
    const cur = this.defaultForModalities();
    if (cur.includes(mod)) {
      this.defaultForModalities.set(cur.filter((m) => m !== mod));
    } else {
      if (!this.modalities().includes(mod)) {
        this.modalities.update((m) => [...m, mod]);
      }
      this.defaultForModalities.set([...cur, mod]);
    }
  }

  addHeaderRow(): void {
    this.extraHeaders.update((h) => [...h, { key: '', value: '' }]);
  }

  removeHeaderRow(idx: number): void {
    this.extraHeaders.update((h) => h.filter((_, i) => i !== idx));
  }

  updateHeaderKey(idx: number, key: string): void {
    this.extraHeaders.update((h) => h.map((item, i) => (i === idx ? { ...item, key } : item)));
  }

  updateHeaderVal(idx: number, value: string): void {
    this.extraHeaders.update((h) => h.map((item, i) => (i === idx ? { ...item, value } : item)));
  }

  addModelRow(): void {
    this.models.update((m) => [
      ...m,
      {
        id: `model-${m.length + 1}`,
        label: `Custom Model ${m.length + 1}`,
        modalities: [...this.modalities()],
        roles: [...this.roles()],
      },
    ]);
  }

  addSuggestedModels(): void {
    const cat = this.catalogEntry();
    if (!cat) return;
    const existingIds = new Set(this.models().map((m) => m.id));
    const toAdd = cat.suggestedModels.filter((m) => !existingIds.has(m.id));
    this.models.update((m) => [...m, ...toAdd]);
  }

  removeModelRow(idx: number): void {
    this.models.update((m) => m.filter((_, i) => i !== idx));
  }

  updateModelId(idx: number, id: string): void {
    this.models.update((m) => m.map((item, i) => (i === idx ? { ...item, id } : item)));
  }

  updateModelLabel(idx: number, label: string): void {
    this.models.update((m) => m.map((item, i) => (i === idx ? { ...item, label } : item)));
  }

  addMappingRow(): void {
    this.assetMappings.update((m) => [
      ...m,
      { path: 'output.file', encoding: 'base64', mimeType: 'image/png', role: 'PRIMARY' },
    ]);
  }

  removeMappingRow(idx: number): void {
    if (this.assetMappings().length <= 1) return;
    this.assetMappings.update((m) => m.filter((_, i) => i !== idx));
  }

  patchMapping(idx: number, patch: Partial<RunPodOutputAssetMapping>): void {
    this.assetMappings.update((m) =>
      m.map((item, i) => (i === idx ? { ...item, ...patch } : item)),
    );
  }

  insertWorkflowVar(v: string): void {
    this.workflowEditor()?.insertAtCaret(`{{${v}}}`);
  }

  patchSetting<K extends keyof ProviderSettings>(key: K, val: ProviderSettings[K]): void {
    this.settings.update((s) => ({ ...s, [key]: val }));
  }

  onWebAuthModeChange(mode: GoogleWebAuthMode): void {
    this.patchSetting('webAuthMode', mode);
    const matchingModels: ModelOption[] = GOOGLE_WEB_MODEL_CATALOG.filter(
      (m) => m.authMode === mode,
    ).map((m) => ({
      id: m.id,
      label: m.label,
      modalities: [...m.modalities],
      roles: [...m.roles],
      notes: m.notes,
    }));
    this.models.set(matchingModels);
    if (matchingModels[0]) {
      this.defaultModel.set(matchingModels[0].id);
    }
  }

  async openGoogleLogin(target: 'gemini' | 'aistudio'): Promise<void> {
    const res = await this.state.loginGoogleWeb(target);
    this.toast.info(
      `Opened browser window to ${res.url}. Complete Google sign-in in the browser window.`,
    );
  }

  async toggleLiveBrowserVisibility(): Promise<void> {
    const visible = await this.state.toggleBrowserVisibility();
    this.toast.info(
      visible
        ? 'Browser window is now visible on screen.'
        : 'Browser window hidden off-screen (headless mode).',
    );
  }

  async deleteLastRunWebChats(): Promise<void> {
    const count = await this.state.deleteLastRunWebChats();
    this.toast.success(
      count > 0
        ? `Deleted ${count} tracked web chat(s) from the last run.`
        : 'No tracked web chats found for the last run.',
    );
  }

  async deleteSingleWebChat(chatId: string): Promise<void> {
    await this.state.deleteWebChatById(chatId);
    this.toast.success('Deleted tracked web chat from browser session.');
  }

  async save(): Promise<void> {
    this.validationErrors.set([]);
    const k = this.kind();
    const isRunpodOrGeneric = k === 'RUNPOD_SERVERLESS' || k === 'GENERIC_HTTP';
    const isComfy = k === 'COMFYUI';

    let payloadTemplate: Record<string, unknown> | null = null;
    if (isRunpodOrGeneric) {
      try {
        payloadTemplate = JSON.parse(this.payloadTemplateText()) as Record<string, unknown>;
      } catch {
        this.validationErrors.set(['Payload template must be valid JSON']);
        return;
      }
    }

    let workflowTemplate: Record<string, unknown> | null = null;
    if (isComfy) {
      if (!this.workflowHasEnhancedPrompt()) {
        this.validationErrors.set([
          'ComfyUI workflow must reference {{enhanced_prompt}} at least once',
        ]);
        return;
      }
      try {
        workflowTemplate = JSON.parse(this.workflowTemplateText()) as Record<string, unknown>;
      } catch {
        this.validationErrors.set(['ComfyUI workflow must be valid JSON']);
        return;
      }
    }

    const outputMapping: OutputMapping | null = isRunpodOrGeneric
      ? {
          assets: this.assetMappings(),
          progressPath: this.progressPath().trim() || undefined,
          errorPath: this.errorPath().trim() || undefined,
          metadataPath: this.metadataPath().trim() || undefined,
        }
      : null;

    const headersMap: Record<string, string> = {};
    for (const h of this.extraHeaders()) {
      if (h.key.trim()) {
        headersMap[h.key.trim()] = h.value;
      }
    }

    let secretValue: string | null | undefined = undefined;
    if (this.secretMode() === 'clear') {
      secretValue = null;
    } else if (this.secretMode() === 'replace' && this.secretDraft().trim()) {
      secretValue = this.secretDraft().trim();
    }

    const rawCandidate = {
      name: this.name().trim(),
      kind: k,
      tier: this.tier(),
      roles: this.roles(),
      modalities: this.modalities(),
      baseUrl: this.baseUrl().trim() ? this.baseUrl().trim() : null,
      secret: secretValue,
      runpodEndpointId: this.runpodEndpointId().trim()
        ? this.runpodEndpointId().trim()
        : null,
      defaultModel: this.defaultModel().trim() ? this.defaultModel().trim() : null,
      models: this.models(),
      payloadTemplate,
      outputMapping,
      workflowTemplate,
      extraHeaders: headersMap,
      settings: this.settings(),
      defaultForModalities: this.defaultForModalities(),
      isEnabled: this.isEnabled(),
    };

    const validation = UpsertProviderSchema.safeParse(rawCandidate);
    if (!validation.success) {
      this.validationErrors.set(
        validation.error.issues.map((i) => `${i.path.join('.') || 'provider'}: ${i.message}`),
      );
      return;
    }

    this.saving.set(true);
    try {
      const existing = this.provider();
      if (existing) {
        const updated = await this.state.updateProvider(existing.id, validation.data);
        this.toast.success(`Saved provider "${updated.name}"`);
        this.secretMode.set(updated.hasSecret ? 'keep' : 'replace');
        this.secretDraft.set('');
        this.saved.emit(updated);
      } else {
        const created = await this.state.createProvider(validation.data);
        this.toast.success(`Created provider "${created.name}"`);
        this.saved.emit(created);
      }
    } catch (err: unknown) {
      this.validationErrors.set([err instanceof Error ? err.message : 'Failed to save provider']);
    } finally {
      this.saving.set(false);
    }
  }

  async remove(): Promise<void> {
    const p = this.provider();
    if (!p) {
      this.cancelledDraft.emit();
      return;
    }
    const res = await this.confirm.confirm({
      title: 'Delete Provider',
      message: `Remove provider "${p.name}"? Active jobs using this provider will block deletion.`,
      confirmLabel: 'Delete Provider',
      danger: true,
    });
    if (res === 'confirm') {
      await this.state.deleteProvider(p.id);
      this.toast.info(`Deleted provider "${p.name}"`);
    }
  }
}
