import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  linkedSignal,
  signal,
  untracked,
} from '@angular/core';
import {
  AssetModel,
  Assets3DParams,
  Assets3DParamsSchema,
  ExecutionMode,
  GenerationSubMode,
  Icons2DParams,
  ImagesParams,
  LoreParams,
  MODALITY_META,
  Modality,
  ModalityParams,
  ModalityParamsSchema,
  MusicParams,
  OtherParams,
  SfxParams,
  VideoParams,
  VideoParamsSchema,
  VoicesParams,
  defaultParamsFor,
} from '@forge/shared';
import { AssetGalleryStore } from '../../../core/state/asset-gallery.store';
import { GeneratorJobStore } from '../../../core/state/generator-job.store';
import { ProviderStateService } from '../../../core/state/provider-state.service';
import { StudioStateService } from '../../../core/state/studio-state.service';
import { ToastService } from '../../../core/state/toast.service';
import { modalityFromRoute } from '../../../core/utils/format';
import { ButtonComponent } from '../../../ui/button/button.component';
import { EmptyStateComponent } from '../../../ui/empty-state/empty-state.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { StatusPillComponent } from '../../../ui/status-pill/status-pill.component';
import { AdvancedParamsComponent } from '../composer/advanced-params/advanced-params.component';
import { GenerationComposerComponent } from '../composer/generation-composer/generation-composer.component';
import { AssetHistoryDrawerComponent } from '../history/asset-history-drawer/asset-history-drawer.component';
import { ReRunPayload } from '../history/asset-inspector/asset-inspector.component';
import { CompileReviewDrawerComponent } from '../middleman/compile-review-drawer/compile-review-drawer.component';
import { MiddlemanStatusPillComponent } from '../middleman/middleman-status-pill/middleman-status-pill.component';
import { Assets3DParamsComponent } from '../params/assets3d-params/assets3d-params.component';
import { IconsParamsComponent } from '../params/icons-params/icons-params.component';
import { ImagesParamsComponent } from '../params/images-params/images-params.component';
import { LoreParamsComponent } from '../params/lore-params/lore-params.component';
import { MusicParamsComponent } from '../params/music-params/music-params.component';
import { OtherParamsComponent } from '../params/other-params/other-params.component';
import { SfxParamsComponent } from '../params/sfx-params/sfx-params.component';
import { VideoParamsComponent } from '../params/video-params/video-params.component';
import { VoicesParamsComponent } from '../params/voices-params/voices-params.component';
import { CodePreviewComponent } from '../previews/code-preview/code-preview.component';
import { DualWaveformPlayerComponent } from '../previews/dual-waveform-player/dual-waveform-player.component';
import { IconPreviewerComponent } from '../previews/icon-previewer/icon-previewer.component';
import { ImagePreviewerComponent } from '../previews/image-previewer/image-previewer.component';
import { JsonTreeViewComponent } from '../previews/json-tree-view/json-tree-view.component';
import { LorePreviewerComponent } from '../previews/lore-previewer/lore-previewer.component';
import { ModelViewportComponent } from '../previews/model-viewport/model-viewport.component';
import { SfxVariationGridComponent } from '../previews/sfx-variation-grid/sfx-variation-grid.component';
import { SpritesheetPlayerComponent } from '../previews/spritesheet-player/spritesheet-player.component';
import { VideoPreviewerComponent } from '../previews/video-previewer/video-previewer.component';
import { VoiceAlignmentViewComponent } from '../previews/voice-alignment-view/voice-alignment-view.component';
import { WorkspaceDraftService } from './workspace-draft.service';

function subModeOf(params: ModalityParams): GenerationSubMode {
  if ('subMode' in params && params.subMode) {
    return params.subMode;
  }
  return 'STANDARD';
}

function paramsValid(params: ModalityParams, rawPrompt: string): boolean {
  if (params.modality === 'VOICES') {
    const transcript = params.transcript.trim() || rawPrompt.trim();
    if (!transcript) return false;
  }
  if (params.modality === 'ASSETS_3D') {
    return Assets3DParamsSchema.safeParse(params).success;
  }
  if (params.modality === 'VIDEO') {
    return VideoParamsSchema.safeParse(params).success;
  }
  return ModalityParamsSchema.safeParse(params).success;
}

@Component({
  selector: 'fs-generator-workspace',
  standalone: true,
  imports: [
    ButtonComponent,
    EmptyStateComponent,
    IconComponent,
    StatusPillComponent,
    GenerationComposerComponent,
    AdvancedParamsComponent,
    IconsParamsComponent,
    Assets3DParamsComponent,
    ImagesParamsComponent,
    VideoParamsComponent,
    LoreParamsComponent,
    MusicParamsComponent,
    VoicesParamsComponent,
    SfxParamsComponent,
    OtherParamsComponent,
    MiddlemanStatusPillComponent,
    CompileReviewDrawerComponent,
    IconPreviewerComponent,
    ModelViewportComponent,
    ImagePreviewerComponent,
    VideoPreviewerComponent,
    LorePreviewerComponent,
    DualWaveformPlayerComponent,
    VoiceAlignmentViewComponent,
    SfxVariationGridComponent,
    SpritesheetPlayerComponent,
    CodePreviewComponent,
    JsonTreeViewComponent,
    AssetHistoryDrawerComponent,
  ],
  templateUrl: './generator-workspace.component.html',
  styleUrl: './generator-workspace.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.history-collapsed]': 'studio.historyCollapsed()',
  },
})
export class GeneratorWorkspaceComponent {
  readonly studio = inject(StudioStateService);
  readonly providers = inject(ProviderStateService);
  readonly jobs = inject(GeneratorJobStore);
  readonly gallery = inject(AssetGalleryStore);
  private readonly drafts = inject(WorkspaceDraftService);
  private readonly toast = inject(ToastService);

  readonly modalityRoute = input.required<string>();

  readonly modality = computed<Modality>(() => modalityFromRoute(this.modalityRoute()));
  readonly meta = computed(() => MODALITY_META[this.modality()]);

  readonly rawPrompt = signal('');
  readonly pinnedFileIds = signal<string[]>([]);

  readonly params = linkedSignal<Modality, ModalityParams>({
    source: this.modality,
    computation: (m) => this.drafts.paramsFor(m) ?? defaultParamsFor(m),
  });

  readonly providerId = linkedSignal<string | null>(
    () => this.providers.defaultProviderFor(this.modality())()?.id ?? null,
  );

  readonly selectedProvider = computed(
    () => this.providers.providers().find((p) => p.id === this.providerId()) ?? null,
  );

  readonly providerModel = linkedSignal<string | null>(
    () => this.selectedProvider()?.defaultModel ?? null,
  );

  readonly middlemanProfileId = linkedSignal<string | null>(
    () => this.providers.defaultProfile()?.id ?? null,
  );

  readonly skipMiddleman = signal(false);
  readonly executionMode = signal<ExecutionMode>('AUTO_FIRE');
  readonly advancedOverrides = signal<Record<string, string | number | boolean>>({});
  readonly submitting = signal(false);
  readonly reviewDrawerOpen = signal(true);

  readonly descriptor = computed(() =>
    this.providers.descriptorFor(this.providerId(), this.modality(), subModeOf(this.params()))(),
  );

  readonly focusedJob = computed(() => this.jobs.focusedJob(this.modality())());

  readonly focusedStream = computed(() => {
    const j = this.focusedJob();
    return j ? (this.jobs.streams()[j.id] ?? null) : null;
  });

  readonly focusedWorkerState = computed(() => {
    const j = this.focusedJob();
    return j ? (this.jobs.workerStates()[j.id] ?? null) : null;
  });

  readonly recommendedParams = computed(() => {
    const j = this.focusedJob();
    const compiled = j?.edited ?? j?.compiled;
    return compiled?.recommendedParams ?? null;
  });

  readonly canSubmit = computed(
    () =>
      Boolean(this.studio.activeProjectId()) &&
      Boolean(this.providerId()) &&
      this.rawPrompt().trim().length > 0 &&
      paramsValid(this.params(), this.rawPrompt()),
  );

  readonly previewAsset = computed(() => {
    const sel = this.gallery.selected();
    if (sel && sel.modality === this.modality()) return sel;
    const job = this.focusedJob();
    if (job && job.assetIds.length > 0) {
      return this.gallery.items().find((a) => job.assetIds.includes(a.id)) ?? null;
    }
    return this.gallery.visibleItems()[0] ?? null;
  });

  constructor() {
    // Load draft on modality / project change and sync gallery modality filter
    effect(() => {
      const m = this.modality();
      const pid = this.studio.activeProjectId();
      untracked(() => {
        this.gallery.setModalityFilter(m);
        const draft = this.drafts.getDraft(m, pid);
        if (draft) {
          this.rawPrompt.set(draft.rawPrompt);
          this.pinnedFileIds.set(draft.pinnedFileIds);
          this.params.set(draft.params);
          if (draft.providerId) this.providerId.set(draft.providerId);
          if (draft.providerModel) this.providerModel.set(draft.providerModel);
          if (draft.middlemanProfileId) {
            this.middlemanProfileId.set(draft.middlemanProfileId);
          }
          this.skipMiddleman.set(draft.skipMiddleman);
          this.executionMode.set(draft.executionMode);
          this.advancedOverrides.set(draft.advancedOverrides);
        } else {
          this.rawPrompt.set('');
          this.pinnedFileIds.set([]);
          this.params.set(defaultParamsFor(m));
          this.skipMiddleman.set(false);
          this.executionMode.set('AUTO_FIRE');
          this.advancedOverrides.set({});
        }
      });
    });

    // Auto-open review drawer whenever focusedJob enters AWAITING_REVIEW
    effect(() => {
      const status = this.focusedJob()?.status;
      if (status === 'AWAITING_REVIEW') {
        untracked(() => this.reviewDrawerOpen.set(true));
      }
    });

    // Persist draft changes
    effect(() => {
      const m = this.modality();
      const pid = this.studio.activeProjectId();
      const rawPrompt = this.rawPrompt();
      const pinnedFileIds = this.pinnedFileIds();
      const params = this.params();
      const providerId = this.providerId();
      const providerModel = this.providerModel();
      const middlemanProfileId = this.middlemanProfileId();
      const skipMiddleman = this.skipMiddleman();
      const executionMode = this.executionMode();
      const advancedOverrides = this.advancedOverrides();

      untracked(() => {
        this.drafts.saveDraft(
          m,
          {
            rawPrompt,
            pinnedFileIds,
            params,
            providerId,
            providerModel,
            middlemanProfileId,
            skipMiddleman,
            executionMode,
            advancedOverrides,
          },
          pid,
        );
      });
    });
  }

  asIconsParams(): Icons2DParams {
    const p = this.params();
    return p.modality === 'ICONS_2D' ? p : defaultParamsFor('ICONS_2D');
  }

  asAssets3DParams(): Assets3DParams {
    const p = this.params();
    return p.modality === 'ASSETS_3D' ? p : defaultParamsFor('ASSETS_3D');
  }

  asImagesParams(): ImagesParams {
    const p = this.params();
    return p.modality === 'IMAGES' ? p : defaultParamsFor('IMAGES');
  }

  asVideoParams(): VideoParams {
    const p = this.params();
    return p.modality === 'VIDEO' ? p : defaultParamsFor('VIDEO');
  }

  asLoreParams(): LoreParams {
    const p = this.params();
    return p.modality === 'LORE' ? p : defaultParamsFor('LORE');
  }

  asMusicParams(): MusicParams {
    const p = this.params();
    return p.modality === 'MUSIC' ? p : defaultParamsFor('MUSIC');
  }

  asVoicesParams(): VoicesParams {
    const p = this.params();
    return p.modality === 'VOICES' ? p : defaultParamsFor('VOICES');
  }

  asSfxParams(): SfxParams {
    const p = this.params();
    return p.modality === 'SFX' ? p : defaultParamsFor('SFX');
  }

  asOtherParams(): OtherParams {
    const p = this.params();
    return p.modality === 'OTHER' ? p : defaultParamsFor('OTHER');
  }

  updateParams(next: ModalityParams): void {
    this.params.set(next);
  }

  batchAssetsFor(asset: AssetModel): AssetModel[] {
    if (asset.jobId) {
      const siblings = this.gallery
        .items()
        .filter((a) => a.jobId === asset.jobId)
        .sort((a, b) => a.batchIndex - b.batchIndex);
      if (siblings.length > 1) return siblings;
    }
    const groupSiblings = this.gallery
      .items()
      .filter((a) => a.assetGroupId === asset.assetGroupId && a.version === asset.version)
      .sort((a, b) => a.batchIndex - b.batchIndex);
    return groupSiblings.length > 0 ? groupSiblings : [asset];
  }

  selectAsset(asset: AssetModel): void {
    this.gallery.selectedAssetId.set(asset.id);
  }

  onReRunWithEdits(payload: ReRunPayload): void {
    this.rawPrompt.set(payload.asset.rawPrompt);
    if (payload.job) {
      this.pinnedFileIds.set([...payload.job.pinnedFileIds]);
      this.params.set(payload.job.params);
      this.providerId.set(payload.job.providerConfigId);
      if (payload.job.providerModel) {
        this.providerModel.set(payload.job.providerModel);
      }
    }
    this.toast.info(`Loaded "${payload.asset.title}" parameters into composer.`);
  }

  async retryFocusedJob(): Promise<void> {
    const job = this.focusedJob();
    if (!job) return;
    await this.jobs.retry(job.id);
  }

  async generate(): Promise<void> {
    await this.submitWithMode(this.executionMode());
  }

  async compileFirst(): Promise<void> {
    await this.submitWithMode('INTERCEPT');
  }

  private async submitWithMode(mode: ExecutionMode): Promise<void> {
    const projectId = this.studio.activeProjectId();
    const providerConfigId = this.providerId();
    if (!projectId || !providerConfigId || !this.canSubmit()) return;

    const currentParams = this.params();
    const normalizedParams: ModalityParams =
      currentParams.modality === 'VOICES' && !currentParams.transcript.trim()
        ? { ...currentParams, transcript: this.rawPrompt().trim() }
        : currentParams;

    this.submitting.set(true);
    try {
      const job = await this.jobs.submit({
        projectId,
        executionMode: mode,
        rawPrompt: this.rawPrompt().trim(),
        pinnedFileIds: this.pinnedFileIds(),
        params: normalizedParams,
        advanced: this.advancedOverrides(),
        providerConfigId,
        providerModel: this.providerModel(),
        middlemanProfileId: this.middlemanProfileId(),
        skipMiddleman: this.skipMiddleman(),
        parentAssetId: null,
      });
      this.toast.info(
        mode === 'INTERCEPT'
          ? `Compiling prompt for review (${job.modality})…`
          : `Queued generation job (${job.modality}).`,
      );
    } finally {
      this.submitting.set(false);
    }
  }
}
