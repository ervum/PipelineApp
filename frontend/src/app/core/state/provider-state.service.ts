import { Injectable, computed, inject, signal } from '@angular/core';
import {
  AdapterDescriptor,
  ExecutionTier,
  GenerationSubMode,
  InterpolationResult,
  MiddlemanProfileModel,
  MiddlemanTemplateModel,
  Modality,
  ProviderCatalogEntry,
  ProviderConfigModel,
  UpsertMiddlemanProfileDto,
  UpsertMiddlemanTemplateDto,
  UpsertProviderDto,
} from '@forge/shared';
import { MiddlemanApi } from '../api/middleman.api';
import {
  GoogleWebStatusResponse,
  ProvidersApi,
  TrackedWebChatItem,
} from '../api/providers.api';
import { SocketService } from '../realtime/socket.service';

@Injectable({ providedIn: 'root' })
export class ProviderStateService {
  private readonly providersApi = inject(ProvidersApi);
  private readonly middlemanApi = inject(MiddlemanApi);
  private readonly socket = inject(SocketService);

  readonly providers = signal<ProviderConfigModel[]>([]);
  readonly catalog = signal<ProviderCatalogEntry[]>([]);
  readonly profiles = signal<MiddlemanProfileModel[]>([]);
  readonly templates = signal<MiddlemanTemplateModel[]>([]);
  readonly adapterDescriptors = signal<Record<string, AdapterDescriptor[]>>({});
  readonly selectedProviderId = signal<string | null>(null);
  readonly webhooksEnabled = signal<boolean>(false);
  readonly loading = signal<boolean>(false);

  readonly googleWebStatus = signal<GoogleWebStatusResponse | null>(null);
  readonly trackedWebChats = signal<TrackedWebChatItem[]>([]);
  readonly browserVisible = computed(
    () => this.googleWebStatus()?.browserVisible ?? false,
  );
  readonly hasGoogleWebProvider = computed(() =>
    this.providers().some((p) => p.kind === 'GOOGLE_WEB' && p.isEnabled),
  );

  readonly selectedProvider = computed(
    () => this.providers().find((p) => p.id === this.selectedProviderId()) ?? null,
  );

  readonly byTier = computed(() => {
    const groups: Record<ExecutionTier, ProviderConfigModel[]> = {
      CLOUD_API: [],
      RUNPOD: [],
      LOCAL: [],
    };
    for (const p of this.providers()) {
      groups[p.tier].push(p);
    }
    return groups;
  });

  readonly llmProviders = computed(() =>
    this.providers().filter((p) => p.roles.includes('LLM') && p.isEnabled),
  );

  readonly defaultProfile = computed(
    () => this.profiles().find((p) => p.isDefault) ?? this.profiles()[0] ?? null,
  );

  readonly hasUnhealthyEnabledProvider = computed(() =>
    this.providers().some(
      (p) =>
        p.isEnabled &&
        (p.health.state === 'UNREACHABLE' || p.health.state === 'UNAUTHORIZED'),
    ),
  );

  readonly enabledForModality = (m: Modality) =>
    computed(() =>
      this.providers()
        .filter((p) => p.isEnabled && p.roles.includes('GENERATOR') && p.modalities.includes(m))
        .sort((a, b) => {
          const aDef = a.defaultForModalities.includes(m) ? 0 : 1;
          const bDef = b.defaultForModalities.includes(m) ? 0 : 1;
          return aDef - bDef || a.name.localeCompare(b.name);
        }),
    );

  readonly defaultProviderFor = (m: Modality) =>
    computed(() => {
      const list = this.enabledForModality(m)();
      return list.find((p) => p.defaultForModalities.includes(m)) ?? list[0] ?? null;
    });

  readonly descriptorFor = (
    providerId: string | null,
    m: Modality,
    subMode?: GenerationSubMode,
  ) =>
    computed(() => {
      if (!providerId) return null;
      const list = this.adapterDescriptors()[providerId] ?? [];
      return (
        list.find(
          (d) => d.modality === m && (!subMode || d.subModes.includes(subMode)),
        ) ??
        list.find((d) => d.modality === m) ??
        null
      );
    });

  constructor() {
    void this.loadAll();

    this.socket.onReconnect(() => {
      if (this.providers().length === 0) {
        void this.loadAll();
      }
    });

    this.socket.on('provider:health', (e) => {
      this.providers.update((list) =>
        list.map((p) =>
          p.id === e.providerConfigId
            ? {
                ...p,
                health: {
                  state: e.state,
                  latencyMs: e.latencyMs,
                  message: e.message,
                  checkedAt: new Date().toISOString(),
                },
              }
            : p,
        ),
      );
    });
  }

  async loadAll(): Promise<void> {
    this.loading.set(true);
    try {
      const [providers, catalog, profiles, templates, health] = await Promise.all([
        this.providersApi.list(),
        this.providersApi.getCatalog(),
        this.middlemanApi.listProfiles(),
        this.middlemanApi.listTemplates(),
        this.providersApi.systemHealth().catch(() => null),
      ]);
      this.providers.set(providers);
      this.catalog.set(catalog);
      this.profiles.set(profiles);
      this.templates.set(templates);
      if (health?.webhooksEnabled !== undefined) {
        this.webhooksEnabled.set(health.webhooksEnabled);
      }
      if (!this.selectedProviderId() && providers[0]) {
        this.selectedProviderId.set(providers[0].id);
      }
      void this.refreshGoogleWebStatus();
    } catch {
      // handled by error interceptor
    } finally {
      this.loading.set(false);
    }
  }

  async refreshGoogleWebStatus(): Promise<void> {
    try {
      const [status, chats] = await Promise.all([
        this.providersApi.getGoogleWebStatus(),
        this.providersApi.listTrackedWebChats(),
      ]);
      this.googleWebStatus.set(status);
      this.trackedWebChats.set(chats);
    } catch {
      // Non-fatal
    }
  }

  async toggleBrowserVisibility(): Promise<boolean> {
    const next = !this.browserVisible();
    const res = await this.providersApi.setBrowserVisibility(next);
    this.googleWebStatus.update((prev) =>
      prev
        ? { ...prev, browserVisible: res.visible, browserRunning: true }
        : {
            geminiAuthenticated: false,
            aiStudioAuthenticated: false,
            browserRunning: true,
            browserVisible: res.visible,
            activeJobs: [],
            trackedChatsCount: 0,
          },
    );
    return res.visible;
  }

  async loginGoogleWeb(
    target: 'gemini' | 'aistudio' = 'aistudio',
  ): Promise<{ url: string; visible: boolean }> {
    const res = await this.providersApi.loginGoogleWeb(target);
    await this.refreshGoogleWebStatus();
    return res;
  }

  async triggerAnswerNow(
    jobId?: string,
  ): Promise<{ clicked: boolean; message: string }> {
    return this.providersApi.triggerAnswerNow(jobId);
  }

  async deleteWebChatById(chatId: string): Promise<void> {
    await this.providersApi.deleteWebChatById(chatId);
    this.trackedWebChats.update((list) => list.filter((c) => c.id !== chatId));
    await this.refreshGoogleWebStatus();
  }

  async deleteLastRunWebChats(): Promise<number> {
    const res = await this.providersApi.deleteLastRunWebChats();
    await this.refreshGoogleWebStatus();
    return res.deletedCount;
  }

  async deleteAllTrackedWebChats(): Promise<number> {
    const res = await this.providersApi.deleteAllTrackedWebChats();
    await this.refreshGoogleWebStatus();
    return res.deletedCount;
  }

  async deleteWebChatsForJob(jobId: string): Promise<number> {
    const res = await this.providersApi.deleteWebChatsForJob(jobId);
    await this.refreshGoogleWebStatus();
    return res.deletedCount;
  }

  async loadDescriptors(providerId: string): Promise<AdapterDescriptor[]> {
    const cached = this.adapterDescriptors()[providerId];
    if (cached) return cached;
    const descriptors = await this.providersApi.getAdapters(providerId);
    this.adapterDescriptors.update((map) => ({ ...map, [providerId]: descriptors }));
    return descriptors;
  }

  async createProvider(dto: UpsertProviderDto): Promise<ProviderConfigModel> {
    const created = await this.providersApi.create(dto);
    await this.refreshProviders();
    this.selectedProviderId.set(created.id);
    return created;
  }

  async updateProvider(
    id: string,
    dto: Partial<UpsertProviderDto>,
  ): Promise<ProviderConfigModel> {
    const updated = await this.providersApi.update(id, dto);
    await this.refreshProviders();
    return updated;
  }

  async deleteProvider(id: string): Promise<void> {
    await this.providersApi.delete(id);
    this.providers.update((l) => l.filter((p) => p.id !== id));
    if (this.selectedProviderId() === id) {
      this.selectedProviderId.set(this.providers()[0]?.id ?? null);
    }
  }

  async checkHealth(id: string): Promise<ProviderConfigModel> {
    const updated = await this.providersApi.checkHealth(id);
    this.providers.update((l) => l.map((p) => (p.id === id ? updated : p)));
    return updated;
  }

  previewTemplate(
    template: Record<string, unknown>,
    variables: Record<string, unknown>,
  ): Promise<InterpolationResult> {
    return this.providersApi.previewTemplate({ template, variables });
  }

  async createProfile(dto: UpsertMiddlemanProfileDto): Promise<MiddlemanProfileModel> {
    const created = await this.middlemanApi.createProfile(dto);
    this.profiles.set(await this.middlemanApi.listProfiles());
    return created;
  }

  async updateProfile(
    id: string,
    dto: Partial<UpsertMiddlemanProfileDto>,
  ): Promise<MiddlemanProfileModel> {
    const updated = await this.middlemanApi.updateProfile(id, dto);
    this.profiles.set(await this.middlemanApi.listProfiles());
    return updated;
  }

  async deleteProfile(id: string): Promise<void> {
    await this.middlemanApi.deleteProfile(id);
    this.profiles.update((l) => l.filter((p) => p.id !== id));
  }

  async saveTemplateVersion(dto: UpsertMiddlemanTemplateDto): Promise<MiddlemanTemplateModel> {
    const created = await this.middlemanApi.createTemplateVersion(dto);
    this.templates.set(await this.middlemanApi.listTemplates());
    return created;
  }

  async activateTemplate(id: string): Promise<MiddlemanTemplateModel> {
    const activated = await this.middlemanApi.activateTemplate(id);
    this.templates.set(await this.middlemanApi.listTemplates());
    return activated;
  }

  private async refreshProviders(): Promise<void> {
    const list = await this.providersApi.list();
    this.providers.set(list);
  }
}
