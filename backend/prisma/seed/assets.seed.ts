import { CompiledPrompt, defaultParamsFor, ModalityParams } from '@forge/shared';
import {
  AiProviderConfig,
  ApprovalStatus,
  ExecutionMode,
  GenerationSubMode,
  JobStatus,
  Modality,
  Prisma,
} from '@prisma/client';
import { StorageKeys } from '../../src/storage/storage-keys';
import { synthesizeGlbMesh } from '../../src/synth/glb-mesh.synth';
import { synthesizeArtPng, synthesizeSpritesheetPng } from '../../src/synth/svg-art.synth';
import { synthesizeIconPng } from '../../src/synth/svg-icon.synth';
import { synthesizeLoreJson, synthesizeShaderCode } from '../../src/synth/text.synth';
import {
  SfxCategory,
  synthesizeMusic,
  synthesizeSfx,
  synthesizeVoice,
} from '../../src/synth/wav-audio.synth';
import { SeededMiddlemanData } from './middleman.seed';
import { SeededProjectBundle } from './project-astra.seed';
import { SeededProvidersMap } from './providers.seed';
import { SeedContext } from './seed-context';

const BASE_EPOCH_MS = new Date('2026-10-12T10:00:00Z').getTime();
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000;

function jobTimestamp(jobIndex: number, offsetMs = 0): Date {
  const step = Math.floor((jobIndex / 40) * TEN_DAYS_MS);
  return new Date(BASE_EPOCH_MS + step + offsetMs);
}

async function createCompletedJobEvents(
  ctx: SeedContext,
  jobId: string,
  baseTime: Date,
  executionMs: number,
  coldStartMs?: number | null,
): Promise<void> {
  const t0 = baseTime.getTime();
  const events: Array<{
    type: string;
    fromStatus: JobStatus | null;
    toStatus: JobStatus | null;
    message: string;
    offsetMs: number;
  }> = [
    {
      type: 'status',
      fromStatus: null,
      toStatus: 'QUEUED',
      message: 'Job queued for execution',
      offsetMs: 0,
    },
    {
      type: 'status',
      fromStatus: 'QUEUED',
      toStatus: 'COMPILING',
      message: 'Middleman prompt compilation started',
      offsetMs: 250,
    },
    {
      type: 'status',
      fromStatus: 'COMPILING',
      toStatus: 'READY',
      message: 'Middleman compiled prompt verified',
      offsetMs: 900,
    },
    {
      type: 'status',
      fromStatus: 'READY',
      toStatus: 'DISPATCHING',
      message: 'Worker slot claimed; dispatching to provider adapter',
      offsetMs: 1100,
    },
  ];

  let runStartOffset = 1300;
  if (coldStartMs && coldStartMs > 0) {
    events.push({
      type: 'status',
      fromStatus: 'DISPATCHING',
      toStatus: 'COLD_START',
      message: `Remote GPU worker initializing (${coldStartMs} ms cold start)`,
      offsetMs: 1300,
    });
    runStartOffset = 1300 + coldStartMs;
    events.push({
      type: 'status',
      fromStatus: 'COLD_START',
      toStatus: 'RUNNING',
      message: 'Worker warm; generation in progress',
      offsetMs: runStartOffset,
    });
  } else {
    events.push({
      type: 'status',
      fromStatus: 'DISPATCHING',
      toStatus: 'RUNNING',
      message: 'Provider accepted generation payload',
      offsetMs: runStartOffset,
    });
  }

  const ingestOffset = runStartOffset + executionMs;
  events.push(
    {
      type: 'status',
      fromStatus: 'RUNNING',
      toStatus: 'INGESTING',
      message: 'Ingesting and post-processing generated outputs',
      offsetMs: ingestOffset,
    },
    {
      type: 'status',
      fromStatus: 'INGESTING',
      toStatus: 'COMPLETED',
      message: 'Asset generation completed and stored',
      offsetMs: ingestOffset + 350,
    },
  );

  await ctx.prisma.generationJobEvent.createMany({
    data: events.map((ev) => ({
      jobId,
      type: ev.type,
      fromStatus: ev.fromStatus,
      toStatus: ev.toStatus,
      message: ev.message,
      payload: {},
      createdAt: new Date(t0 + ev.offsetMs),
    })),
  });
}

function buildSources(
  bundle: SeededProjectBundle,
  names: string[],
): CompiledPrompt['contextSourcesUsed'] {
  const res: CompiledPrompt['contextSourcesUsed'] = [];
  for (const name of names) {
    const f = bundle.filesByName[name];
    if (f) {
      res.push({
        fileId: f.id,
        fileName: f.name,
        reasoningNote: `Applied authoritative palette, proportion, and craft rules from ${f.name}.`,
      });
    }
  }
  return res;
}

export async function seedAssetsAndJobs(
  ctx: SeedContext,
  providers: SeededProvidersMap,
  middleman: SeededMiddlemanData,
  astra: SeededProjectBundle,
  anime: SeededProjectBundle,
): Promise<void> {
  let jobCounter = 0;

  const createCompletedJobRecord = async (opts: {
    bundle: SeededProjectBundle;
    modality: Modality;
    subMode?: GenerationSubMode;
    rawPrompt: string;
    userParams: ModalityParams;
    compiled: CompiledPrompt;
    provider?: AiProviderConfig;
    providerModel?: string;
    batchCount?: number;
    executionMs?: number;
    coldStartMs?: number | null;
    costUsd?: number | null;
    seed: number;
  }) => {
    jobCounter++;
    const createdAt = jobTimestamp(jobCounter);
    const provider = opts.provider ?? providers.demo;
    const executionMs = opts.executionMs ?? 1250;
    const coldStartMs = opts.coldStartMs ?? null;
    const template = middleman.templatesByModality[opts.modality];
    const startedAt = new Date(createdAt.getTime() + 1300 + (coldStartMs ?? 0));
    const completedAt = new Date(startedAt.getTime() + executionMs + 350);

    const job = await ctx.prisma.generationJob.create({
      data: {
        projectId: opts.bundle.project.id,
        modality: opts.modality,
        subMode: opts.subMode ?? 'STANDARD',
        executionMode: 'AUTO_FIRE' as ExecutionMode,
        status: 'COMPLETED',
        rawPrompt: opts.rawPrompt,
        pinnedFileIds: opts.compiled.contextSourcesUsed.slice(0, 2).map((c) => c.fileId),
        userParams: opts.userParams as unknown as Prisma.InputJsonValue,
        referenceStorageKeys: [],
        skipMiddleman: false,
        middlemanProfileId: middleman.defaultProfile.id,
        middlemanTemplateId: template.id,
        middlemanRawOutput: JSON.stringify(opts.compiled, null, 2),
        compiledPayload: opts.compiled as unknown as Prisma.InputJsonValue,
        contextFileIds: opts.compiled.contextSourcesUsed.map((c) => c.fileId),
        middlemanUsage: {
          inputTokens: 1420,
          outputTokens: 310,
          latencyMs: 640,
          model: middleman.defaultProfile.model,
        },
        middlemanStartedAt: new Date(createdAt.getTime() + 250),
        middlemanCompletedAt: new Date(createdAt.getTime() + 900),
        providerConfigId: provider.id,
        providerModel: opts.providerModel ?? provider.defaultModel ?? 'forge-demo-synth-v1',
        tier: provider.tier,
        seed: opts.seed,
        batchCount: opts.batchCount ?? 1,
        progressPercent: 100,
        progressStage: 'completed',
        coldStartMs,
        queueDelayMs: coldStartMs ?? 45,
        executionMs,
        costUsd: opts.costUsd !== undefined && opts.costUsd !== null ? opts.costUsd : 0,
        createdAt,
        dispatchedAt: new Date(createdAt.getTime() + 1100),
        startedAt,
        completedAt,
      },
    });

    await createCompletedJobEvents(ctx, job.id, createdAt, executionMs, coldStartMs);
    return job;
  };

  // Helper: store an Icon asset (+ 512/128/64/32 variants + thumbnail)
  const createIconAsset = async (opts: {
    bundle: SeededProjectBundle;
    jobId: string;
    title: string;
    assetGroupId: string;
    version?: number;
    batchIndex?: number;
    parentAssetId?: string | null;
    rawPrompt: string;
    compiled: CompiledPrompt;
    approval?: ApprovalStatus;
    isFavorite?: boolean;
    tags: string[];
    frameShape?: 'NONE' | 'CIRCLE' | 'ROUNDED_SQUARE' | 'HEXAGON' | 'SHIELD' | 'DIAMOND';
    iconCategory?: 'ITEM' | 'SKILL' | 'RANK_EMBLEM' | 'UI_BUTTON';
    provider?: AiProviderConfig;
    costUsd?: number | null;
    executionMs?: number;
    seed: number;
    createdAt: Date;
  }) => {
    const provider = opts.provider ?? providers.demo;
    const frameShape = opts.frameShape ?? 'NONE';
    const iconCategory = opts.iconCategory ?? 'ITEM';
    const png1024 = await synthesizeIconPng({
      prompt: opts.compiled.enhancedPrompt,
      seed: opts.seed,
      size: 1024,
      frameShape,
      iconCategory,
      removeBackground: true,
    });
    const variants = await ctx.image.iconVariants(png1024);
    const thumbWebp = await ctx.image.thumbnail(png1024, 256);

    const asset = await ctx.prisma.generatedAsset.create({
      data: {
        projectId: opts.bundle.project.id,
        jobId: opts.jobId,
        modality: 'ICONS_2D',
        subMode: 'STANDARD',
        title: opts.title,
        assetGroupId: opts.assetGroupId,
        version: opts.version ?? 1,
        batchIndex: opts.batchIndex ?? 0,
        parentAssetId: opts.parentAssetId ?? null,
        rawPrompt: opts.rawPrompt,
        enhancedPrompt: opts.compiled.enhancedPrompt,
        negativePrompt: opts.compiled.negativePrompt,
        approval: opts.approval ?? 'DRAFT',
        isFavorite: opts.isFavorite ?? false,
        tags: opts.tags,
        notes: '',
        metadata: {
          modality: 'ICONS_2D',
          width: 1024,
          height: 1024,
          hasAlpha: true,
          frameShape,
          iconCategory,
        },
        providerConfigId: provider.id,
        providerKind: provider.kind,
        providerModel: provider.defaultModel,
        tier: provider.tier,
        costUsd: opts.costUsd ?? 0,
        executionMs: opts.executionMs ?? 1100,
        seed: opts.seed,
        createdAt: opts.createdAt,
      },
    });

    const v = opts.version ?? 1;
    const fileSpecs: Array<{
      role: 'PRIMARY' | 'THUMBNAIL' | 'VARIANT_512' | 'VARIANT_128' | 'VARIANT_64' | 'VARIANT_32';
      name: string;
      buf: Buffer;
      mime: string;
      dim: number;
      format: string;
      sortIndex: number;
    }> = [
      {
        role: 'PRIMARY',
        name: 'icon-1024.png',
        buf: png1024,
        mime: 'image/png',
        dim: 1024,
        format: 'png',
        sortIndex: 0,
      },
      {
        role: 'THUMBNAIL',
        name: 'thumb-256.webp',
        buf: thumbWebp,
        mime: 'image/webp',
        dim: 256,
        format: 'webp',
        sortIndex: 1,
      },
      {
        role: 'VARIANT_512',
        name: 'icon-512.png',
        buf: variants[512],
        mime: 'image/png',
        dim: 512,
        format: 'png',
        sortIndex: 2,
      },
      {
        role: 'VARIANT_128',
        name: 'icon-128.png',
        buf: variants[128],
        mime: 'image/png',
        dim: 128,
        format: 'png',
        sortIndex: 3,
      },
      {
        role: 'VARIANT_64',
        name: 'icon-64.png',
        buf: variants[64],
        mime: 'image/png',
        dim: 64,
        format: 'png',
        sortIndex: 4,
      },
      {
        role: 'VARIANT_32',
        name: 'icon-32.png',
        buf: variants[32],
        mime: 'image/png',
        dim: 32,
        format: 'png',
        sortIndex: 5,
      },
    ];

    for (const fs of fileSpecs) {
      const key = StorageKeys.assetFile(
        opts.bundle.project.id,
        'ICONS_2D',
        asset.id,
        v,
        `b${opts.batchIndex ?? 0}_${fs.name}`,
      );
      const stored = await ctx.storage.putBuffer(key, fs.buf, fs.mime);
      ctx.recordBytes(stored.sizeBytes);
      await ctx.prisma.generatedAssetFile.create({
        data: {
          assetId: asset.id,
          role: fs.role,
          storageKey: key,
          fileName: fs.name,
          mimeType: fs.mime,
          sizeBytes: stored.sizeBytes,
          width: fs.dim,
          height: fs.dim,
          format: fs.format,
          sortIndex: fs.sortIndex,
        },
      });
    }

    return asset;
  };

  // ═══════════════════════════════════════════════════════════════════════════
  // ASTRA DREAM — ICONS_2D (5 jobs -> 8 assets)
  // ═══════════════════════════════════════════════════════════════════════════

  // 1 & 2: "Emberfall Katana" (v1 + v2 lineage, APPROVED, favorite)
  const emberfallGroupId = 'grp_astra_emberfall_katana';
  const emberfallCompiledV1: CompiledPrompt = {
    assetTitle: 'Emberfall Katana',
    enhancedPrompt:
      'Single centered legendary curved katana blade rotated 35 degrees clockwise, filling 75% of canvas · Forged Night Indigo #1B1446 steel blade tapering into a sharp star point with polished Starlight Gold #F5C451 crescent crossguard (1.2x chunky scale) and Moon Ivory #F4EFE6 wrapped grip · Upper-left Nebula Cyan #3CD3F0 rim light at 45% intensity with warm Ember Coral #FF6B5A sparks rising from the fuller · Painterly cel-shaded two-tone shadows with crisp ink-free edges · Transparent background with soft Abyss Black #0B0820 drop shadow.',
    negativePrompt: middleman.templatesByModality.ICONS_2D.defaultNegativePrompt,
    recommendedParams: { outputSize: 1024, removeBackground: true },
    contextSourcesUsed: buildSources(astra, [
      'Art Bible.md',
      'Color Palette.md',
      'Icon Style Guide.md',
      'Naming Conventions.md',
    ]),
    warnings: [],
  };
  const seedKatanaV1 = ctx.nextSeedInt();
  const jobKatanaV1 = await createCompletedJobRecord({
    bundle: astra,
    modality: 'ICONS_2D',
    rawPrompt: 'Legendary Emberfall Katana item icon with gold crescent guard',
    userParams: { ...defaultParamsFor('ICONS_2D'), seed: seedKatanaV1 },
    compiled: emberfallCompiledV1,
    seed: seedKatanaV1,
  });
  const assetKatanaV1 = await createIconAsset({
    bundle: astra,
    jobId: jobKatanaV1.id,
    title: 'Emberfall Katana',
    assetGroupId: emberfallGroupId,
    version: 1,
    rawPrompt: jobKatanaV1.rawPrompt,
    compiled: emberfallCompiledV1,
    approval: 'DRAFT',
    isFavorite: false,
    tags: ['weapon', 'katana', 'legendary', 'ember'],
    seed: seedKatanaV1,
    createdAt: jobKatanaV1.completedAt!,
  });

  const emberfallCompiledV2: CompiledPrompt = {
    ...emberfallCompiledV1,
    enhancedPrompt:
      'Hero legendary curved star-katana rotated 35 degrees clockwise, die-cut silhouette readable at 32x32 · Deep Night Indigo #1B1446 fuller inlaid with blazing Starlight Gold #F5C451 filigree and an oversized 1.2x crescent guard housing an Ember Coral #FF6B5A star-crystal core, Moon Ivory #F4EFE6 leather hilt · Crisp Nebula Cyan #3CD3F0 upper-left rim light and single focal gold bloom · Painterly cel-shaded fantasy rendering, zero outlines · Transparent alpha background.',
  };
  const seedKatanaV2 = ctx.nextSeedInt();
  const jobKatanaV2 = await createCompletedJobRecord({
    bundle: astra,
    modality: 'ICONS_2D',
    rawPrompt: 'Refine Emberfall Katana icon with stronger coral star-core glow',
    userParams: { ...defaultParamsFor('ICONS_2D'), seed: seedKatanaV2 },
    compiled: emberfallCompiledV2,
    seed: seedKatanaV2,
  });
  await createIconAsset({
    bundle: astra,
    jobId: jobKatanaV2.id,
    title: 'Emberfall Katana',
    assetGroupId: emberfallGroupId,
    version: 2,
    parentAssetId: assetKatanaV1.id,
    rawPrompt: jobKatanaV2.rawPrompt,
    compiled: emberfallCompiledV2,
    approval: 'APPROVED',
    isFavorite: true,
    tags: ['weapon', 'katana', 'legendary', 'ember'],
    seed: seedKatanaV2,
    createdAt: jobKatanaV2.completedAt!,
  });

  // 3: "Moonlit Elixir" (Rare)
  const elixirCompiled: CompiledPrompt = {
    assetTitle: 'Moonlit Elixir',
    enhancedPrompt:
      'Centered teardrop star-crystal potion flask viewed at a slight 3/4 angle, occupying 75% of frame · Faceted glass body filled with swirling Nebula Cyan #3CD3F0 mana liquid, aged Moon Ivory #F4EFE6 cork stopper, and Starlight Gold #F5C451 collar trim over Night Indigo #1B1446 shadow base · Luminous cyan internal glow and crisp upper-left rim highlight · Painterly two-tone cel-shading with chunky readable silhouette · Transparent background.',
    negativePrompt: middleman.templatesByModality.ICONS_2D.defaultNegativePrompt,
    recommendedParams: { outputSize: 1024, removeBackground: true },
    contextSourcesUsed: buildSources(astra, ['Art Bible.md', 'Color Palette.md', 'Icon Style Guide.md']),
    warnings: [],
  };
  const seedElixir = ctx.nextSeedInt();
  const jobElixir = await createCompletedJobRecord({
    bundle: astra,
    modality: 'ICONS_2D',
    rawPrompt: 'Rare Moonlit Elixir crystal potion flask icon',
    userParams: { ...defaultParamsFor('ICONS_2D'), seed: seedElixir },
    compiled: elixirCompiled,
    seed: seedElixir,
  });
  await createIconAsset({
    bundle: astra,
    jobId: jobElixir.id,
    title: 'Moonlit Elixir',
    assetGroupId: 'grp_astra_moonlit_elixir',
    rawPrompt: jobElixir.rawPrompt,
    compiled: elixirCompiled,
    approval: 'APPROVED',
    tags: ['consumable', 'potion', 'rare', 'mana'],
    seed: seedElixir,
    createdAt: jobElixir.completedAt!,
  });

  // 4: "Comet Sigil" skill badge † OpenAI $0.04
  const cometCompiled: CompiledPrompt = {
    assetTitle: 'Comet Sigil',
    enhancedPrompt:
      'Circular straight-on skill badge centered in frame, bold four-point comet emblem · Blazing Starlight Gold #F5C451 star head with sweeping Nebula Cyan #3CD3F0 tail arc set against a deep Night Indigo #1B1446 and Astral Violet #7C3AED vortex disc · High-contrast value grouping with upper-left cyan rim light and single golden focal bloom · Painterly cel-shaded Astra Dream style · Circular frame with transparent outer alpha.',
    negativePrompt: middleman.templatesByModality.ICONS_2D.defaultNegativePrompt,
    recommendedParams: { outputSize: 1024, removeBackground: true },
    contextSourcesUsed: buildSources(astra, ['Art Bible.md', 'Color Palette.md', 'Icon Style Guide.md']),
    warnings: [],
  };
  const seedComet = ctx.nextSeedInt();
  const jobComet = await createCompletedJobRecord({
    bundle: astra,
    modality: 'ICONS_2D',
    rawPrompt: 'Comet Sigil circular dash skill badge',
    userParams: {
      ...defaultParamsFor('ICONS_2D'),
      iconCategory: 'SKILL',
      frameShape: 'CIRCLE',
      seed: seedComet,
    },
    compiled: cometCompiled,
    provider: providers.openai,
    providerModel: 'gpt-image-1',
    costUsd: 0.04,
    executionMs: 4820,
    seed: seedComet,
  });
  await createIconAsset({
    bundle: astra,
    jobId: jobComet.id,
    title: 'Comet Sigil',
    assetGroupId: 'grp_astra_comet_sigil',
    rawPrompt: jobComet.rawPrompt,
    compiled: cometCompiled,
    approval: 'APPROVED',
    isFavorite: true,
    tags: ['skill', 'badge', 'comet', 'astral'],
    frameShape: 'CIRCLE',
    iconCategory: 'SKILL',
    provider: providers.openai,
    costUsd: 0.04,
    executionMs: 4820,
    seed: seedComet,
    createdAt: jobComet.completedAt!,
  });

  // 5: "Starforged Aegis" (Epic, batch of 4 -> 4 assets batchIndex 0-3)
  const aegisCompiled: CompiledPrompt = {
    assetTitle: 'Starforged Aegis',
    enhancedPrompt:
      'Heroic vanguard kite shield at a slight 3/4 angle, bold chunky silhouette · Night Indigo #1B1446 forged steel face bordered by Astral Violet #7C3AED epic aura runes and a central Starlight Gold #F5C451 four-point star crest · Strong Nebula Cyan #3CD3F0 rim light from upper-left separating the shield bevels · Painterly cel-shaded two-tone shadows, ink-free edges · Transparent background.',
    negativePrompt: middleman.templatesByModality.ICONS_2D.defaultNegativePrompt,
    recommendedParams: { outputSize: 1024, batchCount: 4, removeBackground: true },
    contextSourcesUsed: buildSources(astra, ['Art Bible.md', 'Color Palette.md', 'Icon Style Guide.md']),
    warnings: [],
  };
  const seedAegis = ctx.nextSeedInt();
  const jobAegis = await createCompletedJobRecord({
    bundle: astra,
    modality: 'ICONS_2D',
    rawPrompt: 'Epic Starforged Aegis shield icon (batch of 4 variations)',
    userParams: { ...defaultParamsFor('ICONS_2D'), batchCount: 4, seed: seedAegis },
    compiled: aegisCompiled,
    batchCount: 4,
    seed: seedAegis,
  });
  for (let bIdx = 0; bIdx < 4; bIdx++) {
    await createIconAsset({
      bundle: astra,
      jobId: jobAegis.id,
      title: 'Starforged Aegis',
      assetGroupId: 'grp_astra_starforged_aegis',
      version: 1,
      batchIndex: bIdx,
      rawPrompt: jobAegis.rawPrompt,
      compiled: aegisCompiled,
      approval: bIdx === 0 ? 'APPROVED' : 'DRAFT',
      tags: ['shield', 'armor', 'epic', 'aegis'],
      seed: seedAegis + bIdx,
      createdAt: jobAegis.completedAt!,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ASTRA DREAM — ASSETS_3D (3 jobs -> 3 assets)
  // ═══════════════════════════════════════════════════════════════════════════

  const create3DAsset = async (opts: {
    bundle: SeededProjectBundle;
    jobId: string;
    title: string;
    assetGroupId: string;
    rawPrompt: string;
    compiled: CompiledPrompt;
    category: 'WEAPON' | 'PROP' | 'ENVIRONMENT' | 'CHARACTER_BASE';
    pose?: 'NONE' | 'T_POSE' | 'A_POSE';
    approval?: ApprovalStatus;
    provider?: AiProviderConfig;
    costUsd?: number | null;
    executionMs?: number;
    seed: number;
    createdAt: Date;
    tags: string[];
  }) => {
    const provider = opts.provider ?? providers.demo;
    const meshRes = synthesizeGlbMesh({
      prompt: opts.compiled.enhancedPrompt,
      seed: opts.seed,
      category: opts.category,
      pose: opts.pose ?? 'NONE',
    });
    const thumbPng = await synthesizeIconPng({
      prompt: opts.compiled.enhancedPrompt,
      seed: opts.seed,
      size: 512,
      removeBackground: false,
      solidBackgroundHex: '#1B1446',
    });
    const thumbWebp = await ctx.image.thumbnail(thumbPng, 384);

    const asset = await ctx.prisma.generatedAsset.create({
      data: {
        projectId: opts.bundle.project.id,
        jobId: opts.jobId,
        modality: 'ASSETS_3D',
        subMode: 'TEXT_TO_3D',
        title: opts.title,
        assetGroupId: opts.assetGroupId,
        version: 1,
        batchIndex: 0,
        rawPrompt: opts.rawPrompt,
        enhancedPrompt: opts.compiled.enhancedPrompt,
        negativePrompt: opts.compiled.negativePrompt,
        approval: opts.approval ?? 'DRAFT',
        isFavorite: opts.approval === 'APPROVED',
        tags: opts.tags,
        notes: '',
        metadata: {
          modality: 'ASSETS_3D',
          format: 'glb',
          triangleCount: meshRes.triangleCount,
          vertexCount: meshRes.vertexCount,
          textureResolution: 2048,
          hasPbr: true,
          boundingBox: meshRes.boundingBox,
        },
        providerConfigId: provider.id,
        providerKind: provider.kind,
        providerModel: provider.defaultModel,
        tier: provider.tier,
        costUsd: opts.costUsd ?? 0,
        executionMs: opts.executionMs ?? 2400,
        seed: opts.seed,
        createdAt: opts.createdAt,
      },
    });

    const glbKey = StorageKeys.assetFile(
      opts.bundle.project.id,
      'ASSETS_3D',
      asset.id,
      1,
      'model.glb',
    );
    const thumbKey = StorageKeys.assetFile(
      opts.bundle.project.id,
      'ASSETS_3D',
      asset.id,
      1,
      'thumb.webp',
    );
    const [glbStored, thumbStored] = await Promise.all([
      ctx.storage.putBuffer(glbKey, meshRes.glb, 'model/gltf-binary'),
      ctx.storage.putBuffer(thumbKey, thumbWebp, 'image/webp'),
    ]);
    ctx.recordBytes(glbStored.sizeBytes + thumbStored.sizeBytes);

    await ctx.prisma.generatedAssetFile.createMany({
      data: [
        {
          assetId: asset.id,
          role: 'PRIMARY',
          storageKey: glbKey,
          fileName: 'model.glb',
          mimeType: 'model/gltf-binary',
          sizeBytes: glbStored.sizeBytes,
          format: 'glb',
          sortIndex: 0,
        },
        {
          assetId: asset.id,
          role: 'THUMBNAIL',
          storageKey: thumbKey,
          fileName: 'thumb.webp',
          mimeType: 'image/webp',
          sizeBytes: thumbStored.sizeBytes,
          width: 384,
          height: 384,
          format: 'webp',
          sortIndex: 1,
        },
      ],
    });
    return asset;
  };

  // 6: "Starforged Katana" (WEAPON glb, LOW_POLY, APPROVED)
  const katana3dCompiled: CompiledPrompt = {
    assetTitle: 'Starforged Katana',
    enhancedPrompt:
      'Single isolated game-ready 3D katana weapon mesh, 1.35m real-world length, pivot at grip · Curved single-edged blade in brushed Night Indigo #1B1446 steel (metalness 0.75, roughness 0.38) tapering to a star point, 1.2x oversized crescent guard in polished Starlight Gold #F5C451 (metalness 0.90, roughness 0.22) with faceted Nebula Cyan #3CD3F0 core crystal, Moon Ivory #F4EFE6 cord-wrapped handle · Watertight LOW_POLY topology (~5,000 tris), no floor plane.',
    negativePrompt: middleman.templatesByModality.ASSETS_3D.defaultNegativePrompt,
    recommendedParams: { target_polycount: 5000, texture_resolution: 2048 },
    contextSourcesUsed: buildSources(astra, ['3D Asset Standards.md', 'Color Palette.md', 'Art Bible.md']),
    warnings: [],
  };
  const seedKatana3d = ctx.nextSeedInt();
  const jobKatana3d = await createCompletedJobRecord({
    bundle: astra,
    modality: 'ASSETS_3D',
    subMode: 'TEXT_TO_3D',
    rawPrompt: 'Low-poly game-ready 3D Starforged Katana mesh',
    userParams: {
      ...defaultParamsFor('ASSETS_3D'),
      assetCategory: 'WEAPON',
      polycountTier: 'LOW_POLY',
      seed: seedKatana3d,
    },
    compiled: katana3dCompiled,
    seed: seedKatana3d,
  });
  await create3DAsset({
    bundle: astra,
    jobId: jobKatana3d.id,
    title: 'Starforged Katana',
    assetGroupId: 'grp_astra_3d_katana',
    rawPrompt: jobKatana3d.rawPrompt,
    compiled: katana3dCompiled,
    category: 'WEAPON',
    approval: 'APPROVED',
    seed: seedKatana3d,
    createdAt: jobKatana3d.completedAt!,
    tags: ['3d', 'weapon', 'katana', 'low-poly'],
  });

  // 7: "Dreamforge Anvil" (PROP) † Meshy $0.20, 94 s
  const anvil3dCompiled: CompiledPrompt = {
    assetTitle: 'Dreamforge Anvil',
    enhancedPrompt:
      'Isolated celestial smithing anvil prop, 1.1m wide by 0.95m tall, base pivot at Y=0 · Heavy beveled Night Indigo #1B1446 star-iron body inlaid with glowing Starlight Gold #F5C451 constellation channels (roughness 0.24, metalness 0.88) and a suspended Astral Violet #7C3AED crystal core beneath the horn · Clean watertight LOW_POLY game-ready mesh, no ground plane or environment.',
    negativePrompt: middleman.templatesByModality.ASSETS_3D.defaultNegativePrompt,
    recommendedParams: { target_polycount: 5000, texture_resolution: 2048 },
    contextSourcesUsed: buildSources(astra, ['3D Asset Standards.md', 'Color Palette.md', 'World Lore.md']),
    warnings: [],
  };
  const seedAnvil3d = ctx.nextSeedInt();
  const jobAnvil3d = await createCompletedJobRecord({
    bundle: astra,
    modality: 'ASSETS_3D',
    subMode: 'TEXT_TO_3D',
    rawPrompt: 'Dreamforge celestial anvil prop with gold star-runes',
    userParams: {
      ...defaultParamsFor('ASSETS_3D'),
      assetCategory: 'PROP',
      polycountTier: 'LOW_POLY',
      seed: seedAnvil3d,
    },
    compiled: anvil3dCompiled,
    provider: providers.meshy,
    providerModel: 'meshy-5',
    costUsd: 0.2,
    executionMs: 94000,
    seed: seedAnvil3d,
  });
  await create3DAsset({
    bundle: astra,
    jobId: jobAnvil3d.id,
    title: 'Dreamforge Anvil',
    assetGroupId: 'grp_astra_3d_anvil',
    rawPrompt: jobAnvil3d.rawPrompt,
    compiled: anvil3dCompiled,
    category: 'PROP',
    approval: 'APPROVED',
    provider: providers.meshy,
    costUsd: 0.2,
    executionMs: 94000,
    seed: seedAnvil3d,
    createdAt: jobAnvil3d.completedAt!,
    tags: ['3d', 'prop', 'anvil', 'dreamforge'],
  });

  // 8: "Lyra Base Mesh" (CHARACTER_BASE A-pose)
  const lyra3dCompiled: CompiledPrompt = {
    assetTitle: 'Lyra Base Mesh',
    enhancedPrompt:
      'Symmetrical humanoid character base mesh for Lyra in strict A-pose, 1.68m tall, heel pivot at Y=0 · Stylized Dreamforger tunic in matte Night Indigo #1B1446 cloth (roughness 0.78), aged Moon Ivory #F4EFE6 smithing apron, oversized 1.2x right crescent gauntlet in Starlight Gold #F5C451 filigree, and Astral Violet #7C3AED trim · Clean deformation topology, separated fingers, neutral expression.',
    negativePrompt: middleman.templatesByModality.ASSETS_3D.defaultNegativePrompt,
    recommendedParams: { target_polycount: 30000, texture_resolution: 2048 },
    contextSourcesUsed: buildSources(astra, [
      '3D Asset Standards.md',
      'Lyra - Character Sheet.md',
      'Color Palette.md',
    ]),
    warnings: [],
  };
  const seedLyra3d = ctx.nextSeedInt();
  const jobLyra3d = await createCompletedJobRecord({
    bundle: astra,
    modality: 'ASSETS_3D',
    subMode: 'TEXT_TO_3D',
    rawPrompt: 'Lyra character base mesh in strict A-pose for rigging',
    userParams: {
      ...defaultParamsFor('ASSETS_3D'),
      assetCategory: 'CHARACTER_BASE',
      polycountTier: 'MID_POLY',
      pose: 'A_POSE',
      seed: seedLyra3d,
    },
    compiled: lyra3dCompiled,
    seed: seedLyra3d,
  });
  await create3DAsset({
    bundle: astra,
    jobId: jobLyra3d.id,
    title: 'Lyra Base Mesh',
    assetGroupId: 'grp_astra_3d_lyra',
    rawPrompt: jobLyra3d.rawPrompt,
    compiled: lyra3dCompiled,
    category: 'CHARACTER_BASE',
    pose: 'A_POSE',
    approval: 'DRAFT',
    seed: seedLyra3d,
    createdAt: jobLyra3d.completedAt!,
    tags: ['3d', 'character', 'lyra', 'a-pose'],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ASTRA DREAM — IMAGES (3 jobs -> 3 assets)
  // ═══════════════════════════════════════════════════════════════════════════

  const createImageAsset = async (opts: {
    bundle: SeededProjectBundle;
    jobId: string;
    title: string;
    assetGroupId: string;
    rawPrompt: string;
    compiled: CompiledPrompt;
    aspectPreset: 'SQUARE_1_1' | 'THUMB_16_9' | 'PORTRAIT_9_16' | 'SEAMLESS_TILE';
    width: number;
    height: number;
    tileable: boolean;
    provider?: AiProviderConfig;
    costUsd?: number | null;
    executionMs?: number;
    seed: number;
    createdAt: Date;
    tags: string[];
  }) => {
    const provider = opts.provider ?? providers.demo;
    const pngBuf = await synthesizeArtPng({
      prompt: opts.compiled.enhancedPrompt,
      seed: opts.seed,
      width: opts.width,
      height: opts.height,
      tileable: opts.tileable,
    });
    const thumbWebp = await ctx.image.thumbnail(pngBuf, 384);
    let tileSeamScore: number | undefined;
    if (opts.tileable) {
      const seam = await ctx.image.makeTileable(pngBuf);
      tileSeamScore = seam.seamScore;
    }

    const asset = await ctx.prisma.generatedAsset.create({
      data: {
        projectId: opts.bundle.project.id,
        jobId: opts.jobId,
        modality: 'IMAGES',
        subMode: 'STANDARD',
        title: opts.title,
        assetGroupId: opts.assetGroupId,
        version: 1,
        batchIndex: 0,
        rawPrompt: opts.rawPrompt,
        enhancedPrompt: opts.compiled.enhancedPrompt,
        negativePrompt: opts.compiled.negativePrompt,
        approval: 'APPROVED',
        isFavorite: opts.aspectPreset === 'THUMB_16_9',
        tags: opts.tags,
        notes: '',
        metadata: {
          modality: 'IMAGES',
          width: opts.width,
          height: opts.height,
          aspectPreset: opts.aspectPreset,
          tileable: opts.tileable,
          ...(tileSeamScore !== undefined ? { tileSeamScore } : {}),
        },
        providerConfigId: provider.id,
        providerKind: provider.kind,
        providerModel: provider.defaultModel,
        tier: provider.tier,
        costUsd: opts.costUsd ?? 0,
        executionMs: opts.executionMs ?? 1600,
        seed: opts.seed,
        createdAt: opts.createdAt,
      },
    });

    const mainKey = StorageKeys.assetFile(
      opts.bundle.project.id,
      'IMAGES',
      asset.id,
      1,
      'image.png',
    );
    const thumbKey = StorageKeys.assetFile(
      opts.bundle.project.id,
      'IMAGES',
      asset.id,
      1,
      'thumb.webp',
    );
    const [mainStored, thumbStored] = await Promise.all([
      ctx.storage.putBuffer(mainKey, pngBuf, 'image/png'),
      ctx.storage.putBuffer(thumbKey, thumbWebp, 'image/webp'),
    ]);
    ctx.recordBytes(mainStored.sizeBytes + thumbStored.sizeBytes);

    await ctx.prisma.generatedAssetFile.createMany({
      data: [
        {
          assetId: asset.id,
          role: 'PRIMARY',
          storageKey: mainKey,
          fileName: 'image.png',
          mimeType: 'image/png',
          sizeBytes: mainStored.sizeBytes,
          width: opts.width,
          height: opts.height,
          format: 'png',
          sortIndex: 0,
        },
        {
          assetId: asset.id,
          role: 'THUMBNAIL',
          storageKey: thumbKey,
          fileName: 'thumb.webp',
          mimeType: 'image/webp',
          sizeBytes: thumbStored.sizeBytes,
          width: 384,
          height: Math.round((384 * opts.height) / opts.width),
          format: 'webp',
          sortIndex: 1,
        },
      ],
    });
    return asset;
  };

  // 9: "Dreamforge Vista" concept 16:9
  const vistaCompiled: CompiledPrompt = {
    assetTitle: 'Dreamforge Vista',
    enhancedPrompt:
      'Wide 16:9 environment concept art of the Grand Dreamforge citadel floating beneath the Shattered Firmament · Deep Night Indigo #1B1446 sky graded to Astral Violet #7C3AED clouds, central binary star crucible radiating Starlight Gold #F5C451 bloom, and Nebula Cyan #3CD3F0 aurora bridges connecting Moon Ivory #F4EFE6 stone spires · Painterly cel-shaded lighting, melancholic wonder atmosphere.',
    negativePrompt: middleman.templatesByModality.IMAGES.defaultNegativePrompt,
    recommendedParams: { width: 1536, height: 864 },
    contextSourcesUsed: buildSources(astra, ['Art Bible.md', 'Color Palette.md', 'World Lore.md']),
    warnings: [],
  };
  const seedVista = ctx.nextSeedInt();
  const jobVista = await createCompletedJobRecord({
    bundle: astra,
    modality: 'IMAGES',
    rawPrompt: '16:9 concept art vista of the Grand Dreamforge floating citadel',
    userParams: {
      ...defaultParamsFor('IMAGES'),
      imageCategory: 'CONCEPT_ART',
      aspectPreset: 'THUMB_16_9',
      seed: seedVista,
    },
    compiled: vistaCompiled,
    seed: seedVista,
  });
  await createImageAsset({
    bundle: astra,
    jobId: jobVista.id,
    title: 'Dreamforge Vista',
    assetGroupId: 'grp_astra_img_vista',
    rawPrompt: jobVista.rawPrompt,
    compiled: vistaCompiled,
    aspectPreset: 'THUMB_16_9',
    width: 1536,
    height: 864,
    tileable: false,
    seed: seedVista,
    createdAt: jobVista.completedAt!,
    tags: ['concept-art', 'environment', 'dreamforge'],
  });

  // 10: "Moonstone Tile" SEAMLESS_TILE (tileSeamScore recorded)
  const tileCompiled: CompiledPrompt = {
    assetTitle: 'Moonstone Tile',
    enhancedPrompt:
      'Orthographic top-down seamlessly tileable courtyard floor texture (200cm per tile) · Carved Night Indigo #1B1446 moonstone flags inlaid with subtle Starlight Gold #F5C451 constellation veins and soft Astral Violet #7C3AED mineral flecks · Uniform flat albedo lighting, zero directional shadows or vignette, wrapping edges.',
    negativePrompt: middleman.templatesByModality.IMAGES.defaultNegativePrompt,
    recommendedParams: { width: 1024, height: 1024 },
    contextSourcesUsed: buildSources(astra, ['Art Bible.md', 'Color Palette.md']),
    warnings: [],
  };
  const seedTile = ctx.nextSeedInt();
  const jobTile = await createCompletedJobRecord({
    bundle: astra,
    modality: 'IMAGES',
    rawPrompt: 'Seamless tileable moonstone courtyard floor texture with gold veins',
    userParams: {
      ...defaultParamsFor('IMAGES'),
      imageCategory: 'PBR_TEXTURE',
      aspectPreset: 'SEAMLESS_TILE',
      seed: seedTile,
    },
    compiled: tileCompiled,
    seed: seedTile,
  });
  await createImageAsset({
    bundle: astra,
    jobId: jobTile.id,
    title: 'Moonstone Tile',
    assetGroupId: 'grp_astra_img_tile',
    rawPrompt: jobTile.rawPrompt,
    compiled: tileCompiled,
    aspectPreset: 'SEAMLESS_TILE',
    width: 1024,
    height: 1024,
    tileable: true,
    seed: seedTile,
    createdAt: jobTile.completedAt!,
    tags: ['texture', 'seamless', 'moonstone', 'pbr'],
  });

  // 11: "Astra Dream Thumbnail" 16:9 † RunPod ComfyUI executionMs 21400, coldStartMs 38200, $0.0094
  const thumbCompiled: CompiledPrompt = {
    assetTitle: 'Astra Dream Thumbnail',
    enhancedPrompt:
      '16:9 key art game thumbnail featuring Lyra raising the Emberfall Katana on a cliff overlooking the Shattered Firmament · Bold silhouette against Night Indigo #1B1446 and Astral Violet #7C3AED sky, blazing Starlight Gold #F5C451 blade flare with Ember Coral #FF6B5A sparks and Nebula Cyan #3CD3F0 rim light, clean negative space on left for logo · Painterly cel-shaded hero composition, zero text.',
    negativePrompt: middleman.templatesByModality.IMAGES.defaultNegativePrompt,
    recommendedParams: { width: 1536, height: 864, steps: 28, cfg_scale: 3.5 },
    contextSourcesUsed: buildSources(astra, [
      'Art Bible.md',
      'Color Palette.md',
      'Lyra - Character Sheet.md',
    ]),
    warnings: [],
  };
  const seedThumb = ctx.nextSeedInt();
  const jobThumb = await createCompletedJobRecord({
    bundle: astra,
    modality: 'IMAGES',
    rawPrompt: 'Hero 16:9 game thumbnail with Lyra holding the Emberfall Katana',
    userParams: {
      ...defaultParamsFor('IMAGES'),
      imageCategory: 'THUMBNAIL',
      aspectPreset: 'THUMB_16_9',
      seed: seedThumb,
    },
    compiled: thumbCompiled,
    provider: providers.runpodComfy,
    providerModel: 'flux1-dev-fp8.safetensors',
    executionMs: 21400,
    coldStartMs: 38200,
    costUsd: 0.0094,
    seed: seedThumb,
  });
  await createImageAsset({
    bundle: astra,
    jobId: jobThumb.id,
    title: 'Astra Dream Thumbnail',
    assetGroupId: 'grp_astra_img_thumb',
    rawPrompt: jobThumb.rawPrompt,
    compiled: thumbCompiled,
    aspectPreset: 'THUMB_16_9',
    width: 1536,
    height: 864,
    tileable: false,
    provider: providers.runpodComfy,
    costUsd: 0.0094,
    executionMs: 21400,
    seed: seedThumb,
    createdAt: jobThumb.completedAt!,
    tags: ['thumbnail', 'key-art', 'runpod', 'lyra'],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ASTRA DREAM — MUSIC (2 jobs -> 2 assets)
  // ═══════════════════════════════════════════════════════════════════════════

  const createMusicAsset = async (opts: {
    bundle: SeededProjectBundle;
    jobId: string;
    title: string;
    assetGroupId: string;
    rawPrompt: string;
    compiled: CompiledPrompt;
    durationSec: number;
    bpm: number;
    keySignature: string;
    loop: boolean;
    generateStems: boolean;
    provider?: AiProviderConfig;
    costUsd?: number | null;
    executionMs?: number;
    seed: number;
    createdAt: Date;
    tags: string[];
  }) => {
    const provider = opts.provider ?? providers.demo;
    const synthRes = synthesizeMusic({
      seed: opts.seed,
      durationSec: opts.durationSec,
      bpm: opts.bpm,
      keySignature: opts.keySignature,
      seamlessLoop: opts.loop,
      generateStems: opts.generateStems,
      sampleRate: 22050,
    });

    const asset = await ctx.prisma.generatedAsset.create({
      data: {
        projectId: opts.bundle.project.id,
        jobId: opts.jobId,
        modality: 'MUSIC',
        subMode: 'STANDARD',
        title: opts.title,
        assetGroupId: opts.assetGroupId,
        version: 1,
        batchIndex: 0,
        rawPrompt: opts.rawPrompt,
        enhancedPrompt: opts.compiled.enhancedPrompt,
        negativePrompt: opts.compiled.negativePrompt,
        approval: 'APPROVED',
        isFavorite: opts.generateStems,
        tags: opts.tags,
        notes: '',
        metadata: {
          modality: 'MUSIC',
          durationMs: synthRes.durationMs,
          bpm: opts.bpm,
          keySignature: opts.keySignature,
          loop: opts.loop,
          sampleRate: synthRes.sampleRate,
          stems: synthRes.stems.map((s) => s.name),
        },
        providerConfigId: provider.id,
        providerKind: provider.kind,
        providerModel: provider.defaultModel,
        tier: provider.tier,
        costUsd: opts.costUsd ?? 0,
        executionMs: opts.executionMs ?? 1900,
        seed: opts.seed,
        createdAt: opts.createdAt,
      },
    });

    const masterKey = StorageKeys.assetFile(
      opts.bundle.project.id,
      'MUSIC',
      asset.id,
      1,
      'track.wav',
    );
    const masterStored = await ctx.storage.putBuffer(masterKey, synthRes.masterWav, 'audio/wav');
    ctx.recordBytes(masterStored.sizeBytes);

    await ctx.prisma.generatedAssetFile.create({
      data: {
        assetId: asset.id,
        role: 'PRIMARY',
        storageKey: masterKey,
        fileName: 'track.wav',
        mimeType: 'audio/wav',
        sizeBytes: masterStored.sizeBytes,
        durationMs: synthRes.durationMs,
        format: 'wav',
        sortIndex: 0,
      },
    });

    for (let i = 0; i < synthRes.stems.length; i++) {
      const st = synthRes.stems[i]!;
      const stemFileName = `stem-${st.name}.wav`;
      const stemKey = StorageKeys.assetFile(
        opts.bundle.project.id,
        'MUSIC',
        asset.id,
        1,
        stemFileName,
      );
      const stemStored = await ctx.storage.putBuffer(stemKey, st.wav, 'audio/wav');
      ctx.recordBytes(stemStored.sizeBytes);
      await ctx.prisma.generatedAssetFile.create({
        data: {
          assetId: asset.id,
          role: 'STEM',
          storageKey: stemKey,
          fileName: stemFileName,
          mimeType: 'audio/wav',
          sizeBytes: stemStored.sizeBytes,
          durationMs: synthRes.durationMs,
          format: 'wav',
          sortIndex: i + 1,
        },
      });
    }

    return asset;
  };

  // 12: "Astra's Wish — Exploration Loop" 32 s, 92 BPM, D Dorian, loop, 3 stems
  const wishMusicCompiled: CompiledPrompt = {
    assetTitle: "Astra's Wish — Exploration Loop",
    enhancedPrompt:
      'Celestial orchestral-electronic exploration BGM at 92 BPM in D Dorian, 4/4 time, 32 seconds loop-perfect · Instrumentation: celesta and harp playing the "Astra\'s Wish" rising 5th motif (D–A–G–F–E), warm choir pads, felt piano harmony, and subtle analog synth bass · 0:00 airy choir pad intro, 0:08 celesta motif A, 0:16 harp counter-arp, 0:24 cadential resolution leading seamlessly back into bar 1 · Wide stereo mix, instrumental only.',
    negativePrompt: middleman.templatesByModality.MUSIC.defaultNegativePrompt,
    recommendedParams: { bpm: 92, key_signature: 'D Dorian', duration_seconds: 32, loop: true },
    contextSourcesUsed: buildSources(astra, ['Music Direction.md', 'World Lore.md']),
    warnings: [],
  };
  const seedWishMusic = ctx.nextSeedInt();
  const jobWishMusic = await createCompletedJobRecord({
    bundle: astra,
    modality: 'MUSIC',
    rawPrompt: "Exploration BGM loop with Astra's Wish motif in D Dorian at 92 BPM with stems",
    userParams: {
      ...defaultParamsFor('MUSIC'),
      trackType: 'BGM_LOOP',
      durationSec: 32,
      bpm: 92,
      keySignature: 'D Dorian',
      seamlessLoop: true,
      generateStems: true,
      seed: seedWishMusic,
    },
    compiled: wishMusicCompiled,
    seed: seedWishMusic,
  });
  await createMusicAsset({
    bundle: astra,
    jobId: jobWishMusic.id,
    title: "Astra's Wish — Exploration Loop",
    assetGroupId: 'grp_astra_mus_wish',
    rawPrompt: jobWishMusic.rawPrompt,
    compiled: wishMusicCompiled,
    durationSec: 32,
    bpm: 92,
    keySignature: 'D Dorian',
    loop: true,
    generateStems: true,
    seed: seedWishMusic,
    createdAt: jobWishMusic.completedAt!,
    tags: ['bgm', 'exploration', 'd-dorian', 'stems'],
  });

  // 13: "Hollow Tide — Boss Phase 2" 40 s 152 BPM F minor † ElevenLabs
  const bossMusicCompiled: CompiledPrompt = {
    assetTitle: 'Hollow Tide — Boss Phase 2',
    enhancedPrompt:
      'Intense celestial boss combat track at 152 BPM in F minor, 4/4 time, 40 seconds seamless loop · Driving taiko drums, staccato string ostinatos, pulsing analog synth arpeggios, and soaring Sanctum choir pads punctuated by brass swells · 0:00 aggressive taiko + synth arp launch, 0:12 choir statement of inverted Astra motif, 0:28 climax modulation returning cleanly to bar 1 · Instrumental only, zero electric guitars.',
    negativePrompt: middleman.templatesByModality.MUSIC.defaultNegativePrompt,
    recommendedParams: { bpm: 152, key_signature: 'F minor', duration_seconds: 40, loop: true },
    contextSourcesUsed: buildSources(astra, ['Music Direction.md', 'World Lore.md']),
    warnings: [],
  };
  const seedBossMusic = ctx.nextSeedInt();
  const jobBossMusic = await createCompletedJobRecord({
    bundle: astra,
    modality: 'MUSIC',
    rawPrompt: 'Hollow Tide Boss Phase 2 combat music at 152 BPM in F minor',
    userParams: {
      ...defaultParamsFor('MUSIC'),
      trackType: 'COMBAT',
      durationSec: 40,
      bpm: 152,
      keySignature: 'F minor',
      seamlessLoop: true,
      generateStems: false,
      seed: seedBossMusic,
    },
    compiled: bossMusicCompiled,
    provider: providers.elevenlabs,
    providerModel: 'music_v1',
    costUsd: 0.08,
    executionMs: 11200,
    seed: seedBossMusic,
  });
  await createMusicAsset({
    bundle: astra,
    jobId: jobBossMusic.id,
    title: 'Hollow Tide — Boss Phase 2',
    assetGroupId: 'grp_astra_mus_boss',
    rawPrompt: jobBossMusic.rawPrompt,
    compiled: bossMusicCompiled,
    durationSec: 40,
    bpm: 152,
    keySignature: 'F minor',
    loop: true,
    generateStems: false,
    provider: providers.elevenlabs,
    costUsd: 0.08,
    executionMs: 11200,
    seed: seedBossMusic,
    createdAt: jobBossMusic.completedAt!,
    tags: ['combat', 'boss', 'f-minor', 'elevenlabs'],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ASTRA DREAM — VOICES (3 jobs -> 3 assets)
  // ═══════════════════════════════════════════════════════════════════════════

  const createVoiceAsset = async (opts: {
    bundle: SeededProjectBundle;
    jobId: string;
    title: string;
    assetGroupId: string;
    rawPrompt: string;
    compiled: CompiledPrompt;
    transcript: string;
    voiceProfileId: string | null;
    externalVoiceId: string;
    speed: number;
    seed: number;
    createdAt: Date;
    tags: string[];
  }) => {
    const vRes = synthesizeVoice({
      seed: opts.seed,
      transcript: opts.transcript,
      voiceId: opts.externalVoiceId,
      speed: opts.speed,
    });

    const asset = await ctx.prisma.generatedAsset.create({
      data: {
        projectId: opts.bundle.project.id,
        jobId: opts.jobId,
        modality: 'VOICES',
        subMode: 'STANDARD',
        title: opts.title,
        assetGroupId: opts.assetGroupId,
        version: 1,
        batchIndex: 0,
        rawPrompt: opts.rawPrompt,
        enhancedPrompt: opts.compiled.enhancedPrompt,
        negativePrompt: opts.compiled.negativePrompt,
        approval: 'APPROVED',
        isFavorite: false,
        tags: opts.tags,
        notes: '',
        metadata: {
          modality: 'VOICES',
          durationMs: vRes.durationMs,
          voiceProfileId: opts.voiceProfileId,
          transcript: opts.transcript,
          alignment: {
            words: vRes.alignment.words.map((w) => ({
              word: w.word,
              startMs: w.startMs,
              endMs: w.endMs,
            })),
          },
          sampleRate: vRes.sampleRate,
        },
        providerConfigId: providers.demo.id,
        providerKind: 'DEMO',
        providerModel: 'forge-demo-synth-v1',
        tier: 'LOCAL',
        costUsd: 0,
        executionMs: 750,
        seed: opts.seed,
        createdAt: opts.createdAt,
      },
    });

    const wavKey = StorageKeys.assetFile(
      opts.bundle.project.id,
      'VOICES',
      asset.id,
      1,
      'voice.wav',
    );
    const alignKey = StorageKeys.assetFile(
      opts.bundle.project.id,
      'VOICES',
      asset.id,
      1,
      'alignment.json',
    );
    const alignBuf = Buffer.from(JSON.stringify(vRes.alignment, null, 2), 'utf8');

    const [wavStored, alignStored] = await Promise.all([
      ctx.storage.putBuffer(wavKey, vRes.wav, 'audio/wav'),
      ctx.storage.putBuffer(alignKey, alignBuf, 'application/json'),
    ]);
    ctx.recordBytes(wavStored.sizeBytes + alignStored.sizeBytes);

    await ctx.prisma.generatedAssetFile.createMany({
      data: [
        {
          assetId: asset.id,
          role: 'PRIMARY',
          storageKey: wavKey,
          fileName: 'voice.wav',
          mimeType: 'audio/wav',
          sizeBytes: wavStored.sizeBytes,
          durationMs: vRes.durationMs,
          format: 'wav',
          sortIndex: 0,
        },
        {
          assetId: asset.id,
          role: 'ALIGNMENT',
          storageKey: alignKey,
          fileName: 'alignment.json',
          mimeType: 'application/json',
          sizeBytes: alignStored.sizeBytes,
          format: 'json',
          sortIndex: 1,
        },
      ],
    });
    return asset;
  };

  // 14: "Lyra — 'Every star remembers'"
  const lyraLine = 'Every star remembers the song it sang before the sky broke.';
  const lyraVoiceCompiled: CompiledPrompt = {
    assetTitle: "Lyra — 'Every star remembers'",
    enhancedPrompt: lyraLine,
    negativePrompt: middleman.templatesByModality.VOICES.defaultNegativePrompt,
    recommendedParams: {
      instructions:
        'Soft, earnest alto with slight breathy warmth and quiet wonder, close-mic intimate delivery.',
      stability: 0.45,
      style: 0.35,
      speed: 1.0,
    },
    contextSourcesUsed: buildSources(astra, [
      'Lyra - Character Sheet.md',
      'Voice Casting Notes.md',
    ]),
    warnings: [],
  };
  const seedLyraVoice = ctx.nextSeedInt();
  const jobLyraVoice = await createCompletedJobRecord({
    bundle: astra,
    modality: 'VOICES',
    rawPrompt: 'Lyra speaking her signature discovery line with gentle wonder',
    userParams: {
      ...defaultParamsFor('VOICES'),
      transcript: lyraLine,
      voiceProfileId: astra.voicesByName['Lyra']!.id,
      lineType: 'DIALOGUE',
      emotionTags: ['HEROIC'],
      seed: seedLyraVoice,
    },
    compiled: lyraVoiceCompiled,
    seed: seedLyraVoice,
  });
  await createVoiceAsset({
    bundle: astra,
    jobId: jobLyraVoice.id,
    title: "Lyra — 'Every star remembers'",
    assetGroupId: 'grp_astra_voice_lyra',
    rawPrompt: jobLyraVoice.rawPrompt,
    compiled: lyraVoiceCompiled,
    transcript: lyraLine,
    voiceProfileId: astra.voicesByName['Lyra']!.id,
    externalVoiceId: 'demo-alto-warm',
    speed: 1.0,
    seed: seedLyraVoice,
    createdAt: jobLyraVoice.completedAt!,
    tags: ['voice', 'lyra', 'dialogue'],
  });

  // 15: "Kael — Bark: 'Stay behind me.'"
  const kaelLine = 'Stay behind me.';
  const kaelVoiceCompiled: CompiledPrompt = {
    assetTitle: "Kael — Bark: 'Stay behind me.'",
    enhancedPrompt: kaelLine,
    negativePrompt: middleman.templatesByModality.VOICES.defaultNegativePrompt,
    recommendedParams: {
      instructions: 'Low, grounded baritone combat bark, clipped military urgency and protective grit.',
      stability: 0.55,
      style: 0.3,
      speed: 1.0,
    },
    contextSourcesUsed: buildSources(astra, [
      'Kael - Character Sheet.md',
      'Voice Casting Notes.md',
    ]),
    warnings: [],
  };
  const seedKaelVoice = ctx.nextSeedInt();
  const jobKaelVoice = await createCompletedJobRecord({
    bundle: astra,
    modality: 'VOICES',
    rawPrompt: 'Kael short protective combat bark',
    userParams: {
      ...defaultParamsFor('VOICES'),
      transcript: kaelLine,
      voiceProfileId: astra.voicesByName['Kael']!.id,
      lineType: 'BARK',
      emotionTags: ['HEROIC'],
      seed: seedKaelVoice,
    },
    compiled: kaelVoiceCompiled,
    seed: seedKaelVoice,
  });
  await createVoiceAsset({
    bundle: astra,
    jobId: jobKaelVoice.id,
    title: "Kael — Bark: 'Stay behind me.'",
    assetGroupId: 'grp_astra_voice_kael',
    rawPrompt: jobKaelVoice.rawPrompt,
    compiled: kaelVoiceCompiled,
    transcript: kaelLine,
    voiceProfileId: astra.voicesByName['Kael']!.id,
    externalVoiceId: 'demo-baritone-dry',
    speed: 1.0,
    seed: seedKaelVoice,
    createdAt: jobKaelVoice.completedAt!,
    tags: ['voice', 'kael', 'bark'],
  });

  // 16: "Vesper — Prophecy"
  const vesperLine =
    'When the fifth house weeps ember into indigo water, the sleeper beneath the anvil shall open its golden eye.';
  const vesperVoiceCompiled: CompiledPrompt = {
    assetTitle: 'Vesper — Prophecy',
    enhancedPrompt: vesperLine,
    negativePrompt: middleman.templatesByModality.VOICES.defaultNegativePrompt,
    recommendedParams: {
      instructions:
        'Whispery, ancient oracle narration with slow ceremonial cadence and deliberate pauses.',
      stability: 0.65,
      style: 0.25,
      speed: 0.85,
    },
    contextSourcesUsed: buildSources(astra, [
      'Oracle Vesper - Character Sheet.md',
      'Voice Casting Notes.md',
    ]),
    warnings: [],
  };
  const seedVesperVoice = ctx.nextSeedInt();
  const jobVesperVoice = await createCompletedJobRecord({
    bundle: astra,
    modality: 'VOICES',
    rawPrompt: 'Oracle Vesper prophecy narration line',
    userParams: {
      ...defaultParamsFor('VOICES'),
      transcript: vesperLine,
      voiceProfileId: astra.voicesByName['Oracle Vesper']!.id,
      lineType: 'NARRATION',
      emotionTags: ['WHISPER'],
      speed: 0.85,
      seed: seedVesperVoice,
    },
    compiled: vesperVoiceCompiled,
    seed: seedVesperVoice,
  });
  await createVoiceAsset({
    bundle: astra,
    jobId: jobVesperVoice.id,
    title: 'Vesper — Prophecy',
    assetGroupId: 'grp_astra_voice_vesper',
    rawPrompt: jobVesperVoice.rawPrompt,
    compiled: vesperVoiceCompiled,
    transcript: vesperLine,
    voiceProfileId: astra.voicesByName['Oracle Vesper']!.id,
    externalVoiceId: 'demo-whisper-ancient',
    speed: 0.85,
    seed: seedVesperVoice,
    createdAt: jobVesperVoice.completedAt!,
    tags: ['voice', 'vesper', 'prophecy', 'narration'],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ASTRA DREAM — SFX (3 jobs -> 6 assets)
  // ═══════════════════════════════════════════════════════════════════════════

  const createSfxAsset = async (opts: {
    bundle: SeededProjectBundle;
    jobId: string;
    title: string;
    assetGroupId: string;
    batchIndex: number;
    rawPrompt: string;
    compiled: CompiledPrompt;
    category: SfxCategory;
    durationSec: number;
    loopable: boolean;
    seed: number;
    createdAt: Date;
    tags: string[];
  }) => {
    const sfxRes = synthesizeSfx({
      seed: opts.seed,
      category: opts.category,
      durationSec: opts.durationSec,
      loopable: opts.loopable,
    });

    const asset = await ctx.prisma.generatedAsset.create({
      data: {
        projectId: opts.bundle.project.id,
        jobId: opts.jobId,
        modality: 'SFX',
        subMode: 'STANDARD',
        title: opts.title,
        assetGroupId: opts.assetGroupId,
        version: 1,
        batchIndex: opts.batchIndex,
        rawPrompt: opts.rawPrompt,
        enhancedPrompt: opts.compiled.enhancedPrompt,
        negativePrompt: opts.compiled.negativePrompt,
        approval: opts.batchIndex === 0 ? 'APPROVED' : 'DRAFT',
        isFavorite: false,
        tags: opts.tags,
        notes: '',
        metadata: {
          modality: 'SFX',
          durationMs: sfxRes.durationMs,
          loopable: opts.loopable,
          variationIndex: opts.batchIndex,
          sampleRate: sfxRes.sampleRate,
        },
        providerConfigId: providers.demo.id,
        providerKind: 'DEMO',
        providerModel: 'forge-demo-synth-v1',
        tier: 'LOCAL',
        costUsd: 0,
        executionMs: 620,
        seed: opts.seed,
        createdAt: opts.createdAt,
      },
    });

    const fileName = `sfx-var-${opts.batchIndex + 1}.wav`;
    const key = StorageKeys.assetFile(
      opts.bundle.project.id,
      'SFX',
      asset.id,
      1,
      fileName,
    );
    const stored = await ctx.storage.putBuffer(key, sfxRes.wav, 'audio/wav');
    ctx.recordBytes(stored.sizeBytes);

    await ctx.prisma.generatedAssetFile.create({
      data: {
        assetId: asset.id,
        role: 'PRIMARY',
        storageKey: key,
        fileName,
        mimeType: 'audio/wav',
        sizeBytes: stored.sizeBytes,
        durationMs: sfxRes.durationMs,
        format: 'wav',
        sortIndex: 0,
      },
    });
    return asset;
  };

  // 17: "Crystal Blade Hit" x4 variations (4 assets, same group)
  const hitSfxCompiled: CompiledPrompt = {
    assetTitle: 'Crystal Blade Hit',
    enhancedPrompt:
      'Close-mic dry weapon impact combining forged indigo steel transient strike (0–35 ms), resonant star-crystal harmonic ring in D Dorian (2–5 kHz sparkle), and subtle solar ember crackle tail over 1.2 seconds · No music or speech.',
    negativePrompt: middleman.templatesByModality.SFX.defaultNegativePrompt,
    recommendedParams: { duration_seconds: 1.2, loop: false },
    contextSourcesUsed: buildSources(astra, ['SFX Palette.md', 'VFX Language.md']),
    warnings: [],
  };
  const seedHitSfx = ctx.nextSeedInt();
  const jobHitSfx = await createCompletedJobRecord({
    bundle: astra,
    modality: 'SFX',
    rawPrompt: 'Crystal blade melee hit with star-crystal resonance (4 variations)',
    userParams: {
      ...defaultParamsFor('SFX'),
      sfxCategory: 'WEAPON_HIT',
      durationSec: 1.2,
      variationCount: 4,
      seed: seedHitSfx,
    },
    compiled: hitSfxCompiled,
    batchCount: 4,
    seed: seedHitSfx,
  });
  for (let vIdx = 0; vIdx < 4; vIdx++) {
    await createSfxAsset({
      bundle: astra,
      jobId: jobHitSfx.id,
      title: 'Crystal Blade Hit',
      assetGroupId: 'grp_astra_sfx_crystal_hit',
      batchIndex: vIdx,
      rawPrompt: jobHitSfx.rawPrompt,
      compiled: hitSfxCompiled,
      category: 'WEAPON_HIT',
      durationSec: 1.2,
      loopable: false,
      seed: seedHitSfx + vIdx,
      createdAt: jobHitSfx.completedAt!,
      tags: ['sfx', 'weapon-hit', 'crystal', 'combat'],
    });
  }

  // 18: "Moonstone Footsteps" loopable
  const footstepSfxCompiled: CompiledPrompt = {
    assetTitle: 'Moonstone Footsteps',
    enhancedPrompt:
      'Dry close-mic rhythmic footsteps on carved citadel moonstone pavers, crisp mineral heel-toe tap with subtle 3 kHz crystalline resonance, steady pace, 1.6 seconds seamlessly loopable.',
    negativePrompt: middleman.templatesByModality.SFX.defaultNegativePrompt,
    recommendedParams: { duration_seconds: 1.6, loop: true },
    contextSourcesUsed: buildSources(astra, ['SFX Palette.md']),
    warnings: [],
  };
  const seedFootstep = ctx.nextSeedInt();
  const jobFootstep = await createCompletedJobRecord({
    bundle: astra,
    modality: 'SFX',
    rawPrompt: 'Loopable footsteps on moonstone courtyard pavers',
    userParams: {
      ...defaultParamsFor('SFX'),
      sfxCategory: 'FOOTSTEP',
      durationSec: 1.6,
      loopable: true,
      variationCount: 1,
      seed: seedFootstep,
    },
    compiled: footstepSfxCompiled,
    batchCount: 1,
    seed: seedFootstep,
  });
  await createSfxAsset({
    bundle: astra,
    jobId: jobFootstep.id,
    title: 'Moonstone Footsteps',
    assetGroupId: 'grp_astra_sfx_footsteps',
    batchIndex: 0,
    rawPrompt: jobFootstep.rawPrompt,
    compiled: footstepSfxCompiled,
    category: 'FOOTSTEP',
    durationSec: 1.6,
    loopable: true,
    seed: seedFootstep,
    createdAt: jobFootstep.completedAt!,
    tags: ['sfx', 'footstep', 'loop', 'moonstone'],
  });

  // 19: "UI Confirm Chime"
  const chimeSfxCompiled: CompiledPrompt = {
    assetTitle: 'UI Confirm Chime',
    enhancedPrompt:
      'Short (<260 ms) crystalline UI confirmation sound: tuned quartz glass chime + soft celesta rising fourth interval with brushed gold filigree transient, clean dry decay.',
    negativePrompt: middleman.templatesByModality.SFX.defaultNegativePrompt,
    recommendedParams: { duration_seconds: 0.5, loop: false },
    contextSourcesUsed: buildSources(astra, ['SFX Palette.md']),
    warnings: [],
  };
  const seedChime = ctx.nextSeedInt();
  const jobChime = await createCompletedJobRecord({
    bundle: astra,
    modality: 'SFX',
    rawPrompt: 'Crystalline UI confirm button chime',
    userParams: {
      ...defaultParamsFor('SFX'),
      sfxCategory: 'UI_CLICK',
      durationSec: 0.5,
      variationCount: 1,
      seed: seedChime,
    },
    compiled: chimeSfxCompiled,
    batchCount: 1,
    seed: seedChime,
  });
  await createSfxAsset({
    bundle: astra,
    jobId: jobChime.id,
    title: 'UI Confirm Chime',
    assetGroupId: 'grp_astra_sfx_ui_chime',
    batchIndex: 0,
    rawPrompt: jobChime.rawPrompt,
    compiled: chimeSfxCompiled,
    category: 'UI_CLICK',
    durationSec: 0.5,
    loopable: false,
    seed: seedChime,
    createdAt: jobChime.completedAt!,
    tags: ['sfx', 'ui', 'chime'],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ASTRA DREAM — OTHER (3 jobs -> 3 assets)
  // ═══════════════════════════════════════════════════════════════════════════

  const createSpritesheetAsset = async (opts: {
    bundle: SeededProjectBundle;
    jobId: string;
    title: string;
    assetGroupId: string;
    rawPrompt: string;
    compiled: CompiledPrompt;
    columns: number;
    frameCount: number;
    frameSize: 64 | 128 | 256 | 512;
    fps: number;
    seed: number;
    createdAt: Date;
    tags: string[];
  }) => {
    const sheetRes = await synthesizeSpritesheetPng({
      prompt: opts.compiled.enhancedPrompt,
      seed: opts.seed,
      columns: opts.columns,
      frameCount: opts.frameCount,
      frameSize: opts.frameSize,
    });
    const thumbWebp = await ctx.image.thumbnail(sheetRes.sheetPng, 384);
    const frames = await ctx.image.sliceSpritesheet(
      sheetRes.sheetPng,
      opts.columns,
      sheetRes.rows,
      opts.frameCount,
    );

    const asset = await ctx.prisma.generatedAsset.create({
      data: {
        projectId: opts.bundle.project.id,
        jobId: opts.jobId,
        modality: 'OTHER',
        subMode: 'SPRITESHEET',
        title: opts.title,
        assetGroupId: opts.assetGroupId,
        version: 1,
        batchIndex: 0,
        rawPrompt: opts.rawPrompt,
        enhancedPrompt: opts.compiled.enhancedPrompt,
        negativePrompt: opts.compiled.negativePrompt,
        approval: 'APPROVED',
        isFavorite: false,
        tags: opts.tags,
        notes: '',
        metadata: {
          modality: 'OTHER',
          subMode: 'SPRITESHEET',
          frameCount: opts.frameCount,
          columns: opts.columns,
          frameSize: opts.frameSize,
          fps: opts.fps,
        },
        providerConfigId: providers.demo.id,
        providerKind: 'DEMO',
        providerModel: 'forge-demo-synth-v1',
        tier: 'LOCAL',
        costUsd: 0,
        executionMs: 1850,
        seed: opts.seed,
        createdAt: opts.createdAt,
      },
    });

    const sheetKey = StorageKeys.assetFile(
      opts.bundle.project.id,
      'OTHER',
      asset.id,
      1,
      'spritesheet.png',
    );
    const thumbKey = StorageKeys.assetFile(
      opts.bundle.project.id,
      'OTHER',
      asset.id,
      1,
      'thumb.webp',
    );
    const metaKey = StorageKeys.assetFile(
      opts.bundle.project.id,
      'OTHER',
      asset.id,
      1,
      'spritesheet.json',
    );
    const metaBuf = Buffer.from(
      JSON.stringify(
        {
          frameCount: opts.frameCount,
          columns: opts.columns,
          rows: sheetRes.rows,
          frameSize: opts.frameSize,
          fps: opts.fps,
        },
        null,
        2,
      ),
      'utf8',
    );

    const [sheetStored, thumbStored, metaStored] = await Promise.all([
      ctx.storage.putBuffer(sheetKey, sheetRes.sheetPng, 'image/png'),
      ctx.storage.putBuffer(thumbKey, thumbWebp, 'image/webp'),
      ctx.storage.putBuffer(metaKey, metaBuf, 'application/json'),
    ]);
    ctx.recordBytes(sheetStored.sizeBytes + thumbStored.sizeBytes + metaStored.sizeBytes);

    await ctx.prisma.generatedAssetFile.createMany({
      data: [
        {
          assetId: asset.id,
          role: 'PRIMARY',
          storageKey: sheetKey,
          fileName: 'spritesheet.png',
          mimeType: 'image/png',
          sizeBytes: sheetStored.sizeBytes,
          width: sheetRes.width,
          height: sheetRes.height,
          format: 'png',
          sortIndex: 0,
        },
        {
          assetId: asset.id,
          role: 'THUMBNAIL',
          storageKey: thumbKey,
          fileName: 'thumb.webp',
          mimeType: 'image/webp',
          sizeBytes: thumbStored.sizeBytes,
          width: 384,
          height: 384,
          format: 'webp',
          sortIndex: 1,
        },
        {
          assetId: asset.id,
          role: 'METADATA',
          storageKey: metaKey,
          fileName: 'spritesheet.json',
          mimeType: 'application/json',
          sizeBytes: metaStored.sizeBytes,
          format: 'json',
          sortIndex: 2,
        },
      ],
    });

    for (let fIdx = 0; fIdx < frames.length; fIdx++) {
      const fBuf = frames[fIdx]!;
      const fName = `frame-${String(fIdx).padStart(2, '0')}.png`;
      const fKey = StorageKeys.assetFile(opts.bundle.project.id, 'OTHER', asset.id, 1, fName);
      const fStored = await ctx.storage.putBuffer(fKey, fBuf, 'image/png');
      ctx.recordBytes(fStored.sizeBytes);
      await ctx.prisma.generatedAssetFile.create({
        data: {
          assetId: asset.id,
          role: 'FRAME',
          storageKey: fKey,
          fileName: fName,
          mimeType: 'image/png',
          sizeBytes: fStored.sizeBytes,
          width: opts.frameSize,
          height: opts.frameSize,
          format: 'png',
          sortIndex: 10 + fIdx,
        },
      });
    }

    return asset;
  };

  // 20: Spritesheet "Star Fragment Burst" 4x4 @256 12 fps
  const burstCompiled: CompiledPrompt = {
    assetTitle: 'Star Fragment Burst',
    enhancedPrompt:
      '4x4 grid of 16 evenly timed animation frames at 256x256 per cell showing a four-point Starlight Gold #F5C451 star-fragment ignition burst with Nebula Cyan #3CD3F0 shockwave rings and Astral Violet #7C3AED afterglow · Identical centering and scale across all 16 frames, transparent background.',
    negativePrompt: middleman.templatesByModality.OTHER.defaultNegativePrompt,
    recommendedParams: { frameCount: 16, columns: 4, frameSize: 256, fps: 12 },
    contextSourcesUsed: buildSources(astra, ['VFX Language.md', 'Color Palette.md']),
    warnings: [],
  };
  const seedBurst = ctx.nextSeedInt();
  const jobBurst = await createCompletedJobRecord({
    bundle: astra,
    modality: 'OTHER',
    subMode: 'SPRITESHEET',
    rawPrompt: '4x4 spritesheet of a Star Fragment Burst VFX at 256px 12fps',
    userParams: {
      ...defaultParamsFor('OTHER'),
      subMode: 'SPRITESHEET',
      seed: seedBurst,
    },
    compiled: burstCompiled,
    seed: seedBurst,
  });
  await createSpritesheetAsset({
    bundle: astra,
    jobId: jobBurst.id,
    title: 'Star Fragment Burst',
    assetGroupId: 'grp_astra_other_burst',
    rawPrompt: jobBurst.rawPrompt,
    compiled: burstCompiled,
    columns: 4,
    frameCount: 16,
    frameSize: 256,
    fps: 12,
    seed: seedBurst,
    createdAt: jobBurst.completedAt!,
    tags: ['spritesheet', 'vfx', 'star', 'flipbook'],
  });

  // 21: VFX "Crescent Slash Mask" grayscale
  const maskCompiled: CompiledPrompt = {
    assetTitle: 'Crescent Slash Mask',
    enhancedPrompt:
      'Grayscale single-channel VFX particle mask texture centered on pure black (#000000), sweeping tapered crescent blade arc with crisp leading edge and soft radial falloff to zero before canvas borders, 512x512 resolution.',
    negativePrompt: middleman.templatesByModality.OTHER.defaultNegativePrompt,
    recommendedParams: { resolution: 512, grayscale: true },
    contextSourcesUsed: buildSources(astra, ['VFX Language.md', 'Art Bible.md']),
    warnings: [],
  };
  const seedMask = ctx.nextSeedInt();
  const jobMask = await createCompletedJobRecord({
    bundle: astra,
    modality: 'OTHER',
    subMode: 'VFX_TEXTURE',
    rawPrompt: 'Grayscale crescent sword slash VFX mask texture on pure black',
    userParams: {
      ...defaultParamsFor('OTHER'),
      subMode: 'VFX_TEXTURE',
      vfx: {
        textureType: 'MASK',
        grayscale: true,
        tileable: false,
        resolution: 512,
      },
      seed: seedMask,
    },
    compiled: maskCompiled,
    seed: seedMask,
  });
  const maskPng = await synthesizeArtPng({
    prompt: maskCompiled.enhancedPrompt,
    seed: seedMask,
    width: 512,
    height: 512,
    grayscale: true,
  });
  const maskThumb = await ctx.image.thumbnail(maskPng, 256);
  const maskAsset = await ctx.prisma.generatedAsset.create({
    data: {
      projectId: astra.project.id,
      jobId: jobMask.id,
      modality: 'OTHER',
      subMode: 'VFX_TEXTURE',
      title: 'Crescent Slash Mask',
      assetGroupId: 'grp_astra_other_slash_mask',
      version: 1,
      batchIndex: 0,
      rawPrompt: jobMask.rawPrompt,
      enhancedPrompt: maskCompiled.enhancedPrompt,
      negativePrompt: maskCompiled.negativePrompt,
      approval: 'APPROVED',
      isFavorite: false,
      tags: ['vfx', 'mask', 'grayscale', 'slash'],
      notes: '',
      metadata: {
        modality: 'OTHER',
        subMode: 'VFX_TEXTURE',
      },
      providerConfigId: providers.demo.id,
      providerKind: 'DEMO',
      providerModel: 'forge-demo-synth-v1',
      tier: 'LOCAL',
      costUsd: 0,
      executionMs: 920,
      seed: seedMask,
      createdAt: jobMask.completedAt!,
    },
  });
  const maskMainKey = StorageKeys.assetFile(astra.project.id, 'OTHER', maskAsset.id, 1, 'mask.png');
  const maskThumbKey = StorageKeys.assetFile(
    astra.project.id,
    'OTHER',
    maskAsset.id,
    1,
    'thumb.webp',
  );
  const [maskMainSt, maskThumbSt] = await Promise.all([
    ctx.storage.putBuffer(maskMainKey, maskPng, 'image/png'),
    ctx.storage.putBuffer(maskThumbKey, maskThumb, 'image/webp'),
  ]);
  ctx.recordBytes(maskMainSt.sizeBytes + maskThumbSt.sizeBytes);
  await ctx.prisma.generatedAssetFile.createMany({
    data: [
      {
        assetId: maskAsset.id,
        role: 'PRIMARY',
        storageKey: maskMainKey,
        fileName: 'mask.png',
        mimeType: 'image/png',
        sizeBytes: maskMainSt.sizeBytes,
        width: 512,
        height: 512,
        format: 'png',
        sortIndex: 0,
      },
      {
        assetId: maskAsset.id,
        role: 'THUMBNAIL',
        storageKey: maskThumbKey,
        fileName: 'thumb.webp',
        mimeType: 'image/webp',
        sizeBytes: maskThumbSt.sizeBytes,
        width: 256,
        height: 256,
        format: 'webp',
        sortIndex: 1,
      },
    ],
  });

  // 22: LORE_JSON "Constellation Relics" (8 entries)
  const relicsCompiled: CompiledPrompt = {
    assetTitle: 'Constellation Relics',
    enhancedPrompt:
      'Generate 8 ITEM_TABLE JSON entries for Astra Dream constellation relics strictly following the "<Celestial Adjective> <Noun> of <Constellation/House>" naming pattern and the five Constellation Houses from World Lore.',
    negativePrompt: '',
    recommendedParams: { entryCount: 8, schemaKind: 'ITEM_TABLE' },
    contextSourcesUsed: buildSources(astra, [
      'Naming Conventions.md',
      'World Lore.md',
      'items.json',
    ]),
    warnings: [],
  };
  const seedRelics = ctx.nextSeedInt();
  const jobRelics = await createCompletedJobRecord({
    bundle: astra,
    modality: 'OTHER',
    subMode: 'LORE_JSON',
    rawPrompt: 'JSON table of 8 Constellation Relics following Astra Dream naming rules',
    userParams: {
      ...defaultParamsFor('OTHER'),
      subMode: 'LORE_JSON',
      loreJson: { schemaKind: 'ITEM_TABLE', entryCount: 8, customSchema: null },
      seed: seedRelics,
    },
    compiled: relicsCompiled,
    seed: seedRelics,
  });
  const relicsJson = synthesizeLoreJson({
    prompt: relicsCompiled.enhancedPrompt,
    seed: seedRelics,
    schemaKind: 'ITEM_TABLE',
    entryCount: 8,
  });
  const relicsAsset = await ctx.prisma.generatedAsset.create({
    data: {
      projectId: astra.project.id,
      jobId: jobRelics.id,
      modality: 'OTHER',
      subMode: 'LORE_JSON',
      title: 'Constellation Relics',
      assetGroupId: 'grp_astra_other_relics_json',
      version: 1,
      batchIndex: 0,
      rawPrompt: jobRelics.rawPrompt,
      enhancedPrompt: relicsCompiled.enhancedPrompt,
      negativePrompt: '',
      approval: 'APPROVED',
      isFavorite: false,
      tags: ['json', 'lore', 'relics', 'items'],
      notes: '',
      metadata: {
        modality: 'OTHER',
        subMode: 'LORE_JSON',
        schemaKind: 'ITEM_TABLE',
        lineCount: relicsJson.lineCount,
      },
      providerConfigId: providers.demo.id,
      providerKind: 'DEMO',
      providerModel: 'forge-demo-synth-v1',
      tier: 'LOCAL',
      costUsd: 0,
      executionMs: 540,
      seed: seedRelics,
      createdAt: jobRelics.completedAt!,
    },
  });
  const relicsKey = StorageKeys.assetFile(
    astra.project.id,
    'OTHER',
    relicsAsset.id,
    1,
    'constellation-relics.json',
  );
  const relicsBuf = Buffer.from(relicsJson.jsonText, 'utf8');
  const relicsSt = await ctx.storage.putBuffer(relicsKey, relicsBuf, 'application/json');
  ctx.recordBytes(relicsSt.sizeBytes);
  await ctx.prisma.generatedAssetFile.create({
    data: {
      assetId: relicsAsset.id,
      role: 'PRIMARY',
      storageKey: relicsKey,
      fileName: 'constellation-relics.json',
      mimeType: 'application/json',
      sizeBytes: relicsSt.sizeBytes,
      format: 'json',
      sortIndex: 0,
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIME AWAKENING RNG — ICONS_2D (4 jobs -> 4 assets)
  // ═══════════════════════════════════════════════════════════════════════════

  const rankEmblemDefs: Array<{
    title: string;
    shape: 'CIRCLE' | 'HEXAGON' | 'DIAMOND';
    prompt: string;
    approval: ApprovalStatus;
    fav: boolean;
  }> = [
    {
      title: 'Rank E',
      shape: 'CIRCLE',
      prompt:
        'Straight-on Rank E emblem badge · Plain circular metallic crest in Slate Grey #8A8FA3 with Ink Black #0D0D14 recessed inner bevel and 4px outer outline · Two-tone cel-shaded anime finish, zero glow, zero text · Transparent background.',
      approval: 'APPROVED',
      fav: false,
    },
    {
      title: 'Rank A',
      shape: 'HEXAGON',
      prompt:
        'Straight-on Rank A hexagon crest emblem · Bold Shonen Red #FF2E4D primary bevels with Thunder Yellow #FFE13B inner trim and rising spark particles, framed by a 4px Ink Black #0D0D14 cel outline · High-saturation anime badge, zero letters · Transparent background.',
      approval: 'APPROVED',
      fav: false,
    },
    {
      title: 'Rank S',
      shape: 'DIAMOND',
      prompt:
        'Straight-on Rank S star crest emblem · Blazing Thunder Yellow #FFE13B star silhouette with Shonen Red #FF2E4D secondary wings and jagged lightning arcs, crisp 4px Ink Black #0D0D14 cel-shaded outline, zero text · Transparent background.',
      approval: 'APPROVED',
      fav: true,
    },
    {
      title: 'Rank SSS',
      shape: 'CIRCLE',
      prompt:
        'Straight-on Rank SSS radiant sun crest with sovereign crown · Blinding Paper White #FAFAFF core transitioning through Thunder Yellow #FFE13B to Shonen Red #FF2E4D with Void Purple #6B2BFF chromatic rim and full aura burst, 4px Ink Black #0D0D14 outline, zero text · Transparent background.',
      approval: 'FINAL',
      fav: true,
    },
  ];

  for (const rDef of rankEmblemDefs) {
    const comp: CompiledPrompt = {
      assetTitle: rDef.title,
      enhancedPrompt: rDef.prompt,
      negativePrompt: middleman.templatesByModality.ICONS_2D.defaultNegativePrompt,
      recommendedParams: { outputSize: 1024, removeBackground: true },
      contextSourcesUsed: buildSources(anime, [
        'Rank Emblem Spec.md',
        'Palette & Rank Colors.md',
        'Anime Art Bible.md',
      ]),
      warnings: [],
    };
    const s = ctx.nextSeedInt();
    const job = await createCompletedJobRecord({
      bundle: anime,
      modality: 'ICONS_2D',
      rawPrompt: `${rDef.title} gacha emblem icon without text`,
      userParams: {
        ...defaultParamsFor('ICONS_2D'),
        iconCategory: 'RANK_EMBLEM',
        frameShape: rDef.shape,
        seed: s,
      },
      compiled: comp,
      seed: s,
    });
    await createIconAsset({
      bundle: anime,
      jobId: job.id,
      title: rDef.title,
      assetGroupId: `grp_anime_${rDef.title.toLowerCase().replace(/\s+/g, '_')}`,
      rawPrompt: job.rawPrompt,
      compiled: comp,
      approval: rDef.approval,
      isFavorite: rDef.fav,
      tags: ['rank-emblem', 'anime', rDef.title.toLowerCase()],
      frameShape: rDef.shape,
      iconCategory: 'RANK_EMBLEM',
      seed: s,
      createdAt: job.completedAt!,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIME AWAKENING RNG — ASSETS_3D (1 job -> 1 asset)
  // ═══════════════════════════════════════════════════════════════════════════

  // 27: "Awakening Totem" (PROP)
  const totemCompiled: CompiledPrompt = {
    assetTitle: 'Awakening Totem',
    enhancedPrompt:
      'Isolated 3D anime gacha shrine totem prop, 1.8m tall, base pivot at Y=0 · Obsidian Ink Black #0D0D14 stone obelisk carved with glowing Aura Cyan #22E1FF and Void Purple #6B2BFF energy channels, crowned by a floating Thunder Yellow #FFE13B star crystal · Clean LOW_POLY game-ready topology for Roblox.',
    negativePrompt: middleman.templatesByModality.ASSETS_3D.defaultNegativePrompt,
    recommendedParams: { target_polycount: 5000, texture_resolution: 2048 },
    contextSourcesUsed: buildSources(anime, ['Anime Art Bible.md', 'Palette & Rank Colors.md']),
    warnings: [],
  };
  const seedTotem = ctx.nextSeedInt();
  const jobTotem = await createCompletedJobRecord({
    bundle: anime,
    modality: 'ASSETS_3D',
    subMode: 'TEXT_TO_3D',
    rawPrompt: 'Awakening Shrine Totem prop mesh for Roblox lobby',
    userParams: {
      ...defaultParamsFor('ASSETS_3D'),
      assetCategory: 'PROP',
      polycountTier: 'LOW_POLY',
      seed: seedTotem,
    },
    compiled: totemCompiled,
    seed: seedTotem,
  });
  await create3DAsset({
    bundle: anime,
    jobId: jobTotem.id,
    title: 'Awakening Totem',
    assetGroupId: 'grp_anime_3d_totem',
    rawPrompt: jobTotem.rawPrompt,
    compiled: totemCompiled,
    category: 'PROP',
    approval: 'APPROVED',
    seed: seedTotem,
    createdAt: jobTotem.completedAt!,
    tags: ['3d', 'prop', 'totem', 'roblox'],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIME AWAKENING RNG — IMAGES (2 jobs -> 2 assets)
  // ═══════════════════════════════════════════════════════════════════════════

  // 28: "Lobby Splash Art" 16:9
  const lobbySplashCompiled: CompiledPrompt = {
    assetTitle: 'Lobby Splash Art',
    enhancedPrompt:
      '16:9 high-saturation anime splash art of the Awakening Shrine plaza · Ink Black #0D0D14 night sky split by a towering Void Purple #6B2BFF and Aura Cyan #22E1FF summoning pillar, Sakura Pink #FF7AC6 lantern trees in midground, and radial Thunder Yellow #FFE13B speed lines · Crisp 2-tone cel-shaded key art.',
    negativePrompt: middleman.templatesByModality.IMAGES.defaultNegativePrompt,
    recommendedParams: { width: 1536, height: 864 },
    contextSourcesUsed: buildSources(anime, ['Anime Art Bible.md', 'Palette & Rank Colors.md']),
    warnings: [],
  };
  const seedLobbySplash = ctx.nextSeedInt();
  const jobLobbySplash = await createCompletedJobRecord({
    bundle: anime,
    modality: 'IMAGES',
    rawPrompt: '16:9 anime lobby splash art of the Awakening Shrine',
    userParams: {
      ...defaultParamsFor('IMAGES'),
      imageCategory: 'SPLASH_ART',
      aspectPreset: 'THUMB_16_9',
      seed: seedLobbySplash,
    },
    compiled: lobbySplashCompiled,
    seed: seedLobbySplash,
  });
  await createImageAsset({
    bundle: anime,
    jobId: jobLobbySplash.id,
    title: 'Lobby Splash Art',
    assetGroupId: 'grp_anime_img_lobby_splash',
    rawPrompt: jobLobbySplash.rawPrompt,
    compiled: lobbySplashCompiled,
    aspectPreset: 'THUMB_16_9',
    width: 1536,
    height: 864,
    tileable: false,
    seed: seedLobbySplash,
    createdAt: jobLobbySplash.completedAt!,
    tags: ['splash-art', 'lobby', 'anime'],
  });

  // 29: "Aura Roll Thumbnail" 16:9
  const rollThumbCompiled: CompiledPrompt = {
    assetTitle: 'Aura Roll Thumbnail',
    enhancedPrompt:
      '16:9 Roblox discovery thumbnail showing Ren unleashing an SSS-Rank Sovereign aura · Blinding Paper White #FAFAFF core erupting into Thunder Yellow #FFE13B lightning and Shonen Red #FF2E4D plasma wings with Void Purple #6B2BFF chromatic rim and Ink Black #0D0D14 speed lines · High mobile contrast, zero text.',
    negativePrompt: middleman.templatesByModality.IMAGES.defaultNegativePrompt,
    recommendedParams: { width: 1536, height: 864 },
    contextSourcesUsed: buildSources(anime, [
      'Anime Art Bible.md',
      'Palette & Rank Colors.md',
      'Hero Roster.md',
    ]),
    warnings: [],
  };
  const seedRollThumb = ctx.nextSeedInt();
  const jobRollThumb = await createCompletedJobRecord({
    bundle: anime,
    modality: 'IMAGES',
    rawPrompt: '16:9 high-clickthrough Roblox thumbnail for SSS aura roll',
    userParams: {
      ...defaultParamsFor('IMAGES'),
      imageCategory: 'THUMBNAIL',
      aspectPreset: 'THUMB_16_9',
      seed: seedRollThumb,
    },
    compiled: rollThumbCompiled,
    seed: seedRollThumb,
  });
  await createImageAsset({
    bundle: anime,
    jobId: jobRollThumb.id,
    title: 'Aura Roll Thumbnail',
    assetGroupId: 'grp_anime_img_roll_thumb',
    rawPrompt: jobRollThumb.rawPrompt,
    compiled: rollThumbCompiled,
    aspectPreset: 'THUMB_16_9',
    width: 1536,
    height: 864,
    tileable: false,
    seed: seedRollThumb,
    createdAt: jobRollThumb.completedAt!,
    tags: ['thumbnail', 'roblox', 'aura', 'sss'],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIME AWAKENING RNG — MUSIC (1 job -> 1 asset)
  // ═══════════════════════════════════════════════════════════════════════════

  // 30: "Lobby — Kawaii Synth Pop" 30 s 120 BPM loop
  const kawaiiMusicCompiled: CompiledPrompt = {
    assetTitle: 'Lobby — Kawaii Synth Pop',
    enhancedPrompt:
      'Upbeat kawaii future-bass and synth-pop lobby BGM at 120 BPM in C major, 4/4 time, 30 seconds seamless loop · Bright plucky bell lead, bouncy sidechained supersaw chords, punchy electronic kick/snare, and sparkling arpeggio textures · Instrumental only, bar-aligned loop boundary.',
    negativePrompt: middleman.templatesByModality.MUSIC.defaultNegativePrompt,
    recommendedParams: { bpm: 120, key_signature: 'C major', duration_seconds: 30, loop: true },
    contextSourcesUsed: buildSources(anime, ['Audio Direction.md']),
    warnings: [],
  };
  const seedKawaii = ctx.nextSeedInt();
  const jobKawaii = await createCompletedJobRecord({
    bundle: anime,
    modality: 'MUSIC',
    rawPrompt: 'Kawaii synth-pop lobby BGM loop at 120 BPM',
    userParams: {
      ...defaultParamsFor('MUSIC'),
      trackType: 'BGM_LOOP',
      durationSec: 30,
      bpm: 120,
      keySignature: 'C major',
      seamlessLoop: true,
      generateStems: false,
      seed: seedKawaii,
    },
    compiled: kawaiiMusicCompiled,
    seed: seedKawaii,
  });
  await createMusicAsset({
    bundle: anime,
    jobId: jobKawaii.id,
    title: 'Lobby — Kawaii Synth Pop',
    assetGroupId: 'grp_anime_mus_lobby',
    rawPrompt: jobKawaii.rawPrompt,
    compiled: kawaiiMusicCompiled,
    durationSec: 30,
    bpm: 120,
    keySignature: 'C major',
    loop: true,
    generateStems: false,
    seed: seedKawaii,
    createdAt: jobKawaii.completedAt!,
    tags: ['bgm', 'kawaii', 'synth-pop', 'lobby'],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIME AWAKENING RNG — VOICES (1 job -> 1 asset)
  // ═══════════════════════════════════════════════════════════════════════════

  // 31: "Announcer — 'SSS RANK AWAKENED!'"
  const announcerLine = 'SSS RANK AWAKENED!';
  const announcerCompiled: CompiledPrompt = {
    assetTitle: "Announcer — 'SSS RANK AWAKENED!'",
    enhancedPrompt: announcerLine,
    negativePrompt: middleman.templatesByModality.VOICES.defaultNegativePrompt,
    recommendedParams: {
      instructions:
        'Explosive arcade tournament shoutcaster delivery with maximum hype and punchy projection.',
      stability: 0.3,
      style: 0.85,
      speed: 1.1,
    },
    contextSourcesUsed: buildSources(anime, ['Hero Roster.md', 'Audio Direction.md']),
    warnings: [],
  };
  const seedAnnouncer = ctx.nextSeedInt();
  const jobAnnouncer = await createCompletedJobRecord({
    bundle: anime,
    modality: 'VOICES',
    rawPrompt: 'Hype announcer shouting SSS RANK AWAKENED',
    userParams: {
      ...defaultParamsFor('VOICES'),
      transcript: announcerLine,
      voiceProfileId: anime.voicesByName['Announcer']!.id,
      lineType: 'BARK',
      emotionTags: ['SHOUT', 'HEROIC'],
      speed: 1.1,
      seed: seedAnnouncer,
    },
    compiled: announcerCompiled,
    seed: seedAnnouncer,
  });
  await createVoiceAsset({
    bundle: anime,
    jobId: jobAnnouncer.id,
    title: "Announcer — 'SSS RANK AWAKENED!'",
    assetGroupId: 'grp_anime_voice_announcer',
    rawPrompt: jobAnnouncer.rawPrompt,
    compiled: announcerCompiled,
    transcript: announcerLine,
    voiceProfileId: anime.voicesByName['Announcer']!.id,
    externalVoiceId: 'demo-announcer-hype',
    speed: 1.1,
    seed: seedAnnouncer,
    createdAt: jobAnnouncer.completedAt!,
    tags: ['voice', 'announcer', 'sss', 'bark'],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIME AWAKENING RNG — SFX (2 jobs -> 5 assets)
  // ═══════════════════════════════════════════════════════════════════════════

  // 32: "Roll Tick" x4
  const rollTickCompiled: CompiledPrompt = {
    assetTitle: 'Roll Tick',
    enhancedPrompt:
      'Crisp 90 ms arcade gacha slot cycle click with bright square-wave transient and high crystalline overtone, dry close-mic, 4 subtle pitch variations.',
    negativePrompt: middleman.templatesByModality.SFX.defaultNegativePrompt,
    recommendedParams: { duration_seconds: 0.5, loop: false },
    contextSourcesUsed: buildSources(anime, ['Audio Direction.md']),
    warnings: [],
  };
  const seedRollTick = ctx.nextSeedInt();
  const jobRollTick = await createCompletedJobRecord({
    bundle: anime,
    modality: 'SFX',
    rawPrompt: 'Gacha roll slot tick sound effect (4 variations)',
    userParams: {
      ...defaultParamsFor('SFX'),
      sfxCategory: 'UI_CLICK',
      durationSec: 0.5,
      variationCount: 4,
      seed: seedRollTick,
    },
    compiled: rollTickCompiled,
    batchCount: 4,
    seed: seedRollTick,
  });
  for (let vIdx = 0; vIdx < 4; vIdx++) {
    await createSfxAsset({
      bundle: anime,
      jobId: jobRollTick.id,
      title: 'Roll Tick',
      assetGroupId: 'grp_anime_sfx_roll_tick',
      batchIndex: vIdx,
      rawPrompt: jobRollTick.rawPrompt,
      compiled: rollTickCompiled,
      category: 'UI_CLICK',
      durationSec: 0.5,
      loopable: false,
      seed: seedRollTick + vIdx,
      createdAt: jobRollTick.completedAt!,
      tags: ['sfx', 'ui', 'gacha', 'roll-tick'],
    });
  }

  // 33: "SSS Reveal Boom"
  const revealBoomCompiled: CompiledPrompt = {
    assetTitle: 'SSS Reveal Boom',
    enhancedPrompt:
      'Massive anime gacha SSS reveal impact: 40 Hz sub-bass drop + thunderous lightning transient crack + radiant harmonic synth chord tail over 2.8 seconds · Zero speech.',
    negativePrompt: middleman.templatesByModality.SFX.defaultNegativePrompt,
    recommendedParams: { duration_seconds: 2.8, loop: false },
    contextSourcesUsed: buildSources(anime, ['Audio Direction.md']),
    warnings: [],
  };
  const seedBoom = ctx.nextSeedInt();
  const jobBoom = await createCompletedJobRecord({
    bundle: anime,
    modality: 'SFX',
    rawPrompt: 'SSS rank reveal sub-bass boom and lightning impact',
    userParams: {
      ...defaultParamsFor('SFX'),
      sfxCategory: 'EXPLOSION',
      durationSec: 2.8,
      variationCount: 1,
      seed: seedBoom,
    },
    compiled: revealBoomCompiled,
    batchCount: 1,
    seed: seedBoom,
  });
  await createSfxAsset({
    bundle: anime,
    jobId: jobBoom.id,
    title: 'SSS Reveal Boom',
    assetGroupId: 'grp_anime_sfx_sss_boom',
    batchIndex: 0,
    rawPrompt: jobBoom.rawPrompt,
    compiled: revealBoomCompiled,
    category: 'EXPLOSION',
    durationSec: 2.8,
    loopable: false,
    seed: seedBoom,
    createdAt: jobBoom.completedAt!,
    tags: ['sfx', 'explosion', 'sss', 'reveal'],
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ANIME AWAKENING RNG — OTHER (3 jobs -> 3 assets)
  // ═══════════════════════════════════════════════════════════════════════════

  // 34: SHADER_CODE Luau "AuraSSS.lua"
  const luauCompiled: CompiledPrompt = {
    assetTitle: 'AuraSSS.lua',
    enhancedPrompt:
      'Strict Roblox Luau ModuleScript (--!strict) implementing AuraVFX.Create(parent: BasePart, params: AuraParams): () -> () for Rank SSS Sovereign Aura · Uses <= 3 ParticleEmitters (Rate <= 40 for mobile), ColorSequence with #FFFFFF core -> #FFE13B -> #FF2E4D -> #6B2BFF, pulsing Highlight via TweenService, and safe cleanup disabling emitters before delayed Destroy.',
    negativePrompt: '',
    recommendedParams: { language: 'LUAU', targetEngine: 'ROBLOX' },
    contextSourcesUsed: buildSources(anime, [
      'Luau Conventions.md',
      'Aura VFX Guide.md',
      'Palette & Rank Colors.md',
    ]),
    warnings: [],
  };
  const seedLuau = ctx.nextSeedInt();
  const jobLuau = await createCompletedJobRecord({
    bundle: anime,
    modality: 'OTHER',
    subMode: 'SHADER_CODE',
    rawPrompt: 'Roblox Luau VFX module AuraSSS.lua for SSS rank aura',
    userParams: {
      ...defaultParamsFor('OTHER'),
      subMode: 'SHADER_CODE',
      shader: { language: 'LUAU', targetEngine: 'ROBLOX' },
      seed: seedLuau,
    },
    compiled: luauCompiled,
    seed: seedLuau,
  });
  const luauSynth = synthesizeShaderCode({
    prompt: luauCompiled.enhancedPrompt,
    seed: seedLuau,
    language: 'LUAU',
    targetEngine: 'ROBLOX',
  });
  const luauAsset = await ctx.prisma.generatedAsset.create({
    data: {
      projectId: anime.project.id,
      jobId: jobLuau.id,
      modality: 'OTHER',
      subMode: 'SHADER_CODE',
      title: 'AuraSSS.lua',
      assetGroupId: 'grp_anime_other_aura_sss_lua',
      version: 1,
      batchIndex: 0,
      rawPrompt: jobLuau.rawPrompt,
      enhancedPrompt: luauCompiled.enhancedPrompt,
      negativePrompt: '',
      approval: 'FINAL',
      isFavorite: true,
      tags: ['luau', 'roblox', 'vfx', 'sss'],
      notes: '',
      metadata: {
        modality: 'OTHER',
        subMode: 'SHADER_CODE',
        language: 'LUAU',
        lineCount: luauSynth.lineCount,
      },
      providerConfigId: providers.demo.id,
      providerKind: 'DEMO',
      providerModel: 'forge-demo-synth-v1',
      tier: 'LOCAL',
      costUsd: 0,
      executionMs: 680,
      seed: seedLuau,
      createdAt: jobLuau.completedAt!,
    },
  });
  const luauKey = StorageKeys.assetFile(anime.project.id, 'OTHER', luauAsset.id, 1, 'AuraSSS.lua');
  const luauBuf = Buffer.from(luauSynth.code, 'utf8');
  const luauSt = await ctx.storage.putBuffer(luauKey, luauBuf, 'text/x-luau; charset=utf-8');
  ctx.recordBytes(luauSt.sizeBytes);
  await ctx.prisma.generatedAssetFile.create({
    data: {
      assetId: luauAsset.id,
      role: 'PRIMARY',
      storageKey: luauKey,
      fileName: 'AuraSSS.lua',
      mimeType: 'text/x-luau; charset=utf-8',
      sizeBytes: luauSt.sizeBytes,
      format: 'lua',
      sortIndex: 0,
    },
  });

  // 35: Spritesheet "Lightning Aura Flipbook" 4x4
  const lightningFlipCompiled: CompiledPrompt = {
    assetTitle: 'Lightning Aura Flipbook',
    enhancedPrompt:
      '4x4 flipbook spritesheet (16 frames at 256x256 per cell) of jagged anime awakening lightning arcs in Thunder Yellow #FFE13B and Shonen Red #FF2E4D with Aura Cyan #22E1FF sparks · Centered with 16px safe cell padding, transparent alpha.',
    negativePrompt: middleman.templatesByModality.OTHER.defaultNegativePrompt,
    recommendedParams: { frameCount: 16, columns: 4, frameSize: 256, fps: 16 },
    contextSourcesUsed: buildSources(anime, ['Aura VFX Guide.md', 'Palette & Rank Colors.md']),
    warnings: [],
  };
  const seedFlip = ctx.nextSeedInt();
  const jobFlip = await createCompletedJobRecord({
    bundle: anime,
    modality: 'OTHER',
    subMode: 'SPRITESHEET',
    rawPrompt: '4x4 Lightning Aura Flipbook spritesheet at 256px',
    userParams: {
      ...defaultParamsFor('OTHER'),
      subMode: 'SPRITESHEET',
      spritesheet: {
        frameCount: 16,
        columns: 4,
        frameSize: 256,
        animationType: 'LOOP_FX',
        fps: 16,
      },
      seed: seedFlip,
    },
    compiled: lightningFlipCompiled,
    seed: seedFlip,
  });
  await createSpritesheetAsset({
    bundle: anime,
    jobId: jobFlip.id,
    title: 'Lightning Aura Flipbook',
    assetGroupId: 'grp_anime_other_lightning_flipbook',
    rawPrompt: jobFlip.rawPrompt,
    compiled: lightningFlipCompiled,
    columns: 4,
    frameCount: 16,
    frameSize: 256,
    fps: 16,
    seed: seedFlip,
    createdAt: jobFlip.completedAt!,
    tags: ['spritesheet', 'lightning', 'aura', 'flipbook'],
  });

  // 36: LORE_JSON "Gacha Aura Table"
  const gachaTableCompiled: CompiledPrompt = {
    assetTitle: 'Gacha Aura Table',
    enhancedPrompt:
      'Generate 8 structured ITEM_TABLE JSON entries for Anime Awakening RNG rollable auras spanning Ranks E through SSS with hex palette references and odds.',
    negativePrompt: '',
    recommendedParams: { entryCount: 8, schemaKind: 'ITEM_TABLE' },
    contextSourcesUsed: buildSources(anime, ['gacha-table.json', 'Palette & Rank Colors.md']),
    warnings: [],
  };
  const seedGachaJson = ctx.nextSeedInt();
  const jobGachaJson = await createCompletedJobRecord({
    bundle: anime,
    modality: 'OTHER',
    subMode: 'LORE_JSON',
    rawPrompt: 'Gacha Aura Table JSON expansion with 8 rollable auras',
    userParams: {
      ...defaultParamsFor('OTHER'),
      subMode: 'LORE_JSON',
      loreJson: { schemaKind: 'ITEM_TABLE', entryCount: 8, customSchema: null },
      seed: seedGachaJson,
    },
    compiled: gachaTableCompiled,
    seed: seedGachaJson,
  });
  const gachaJsonRes = synthesizeLoreJson({
    prompt: gachaTableCompiled.enhancedPrompt,
    seed: seedGachaJson,
    schemaKind: 'ITEM_TABLE',
    entryCount: 8,
  });
  const gachaJsonAsset = await ctx.prisma.generatedAsset.create({
    data: {
      projectId: anime.project.id,
      jobId: jobGachaJson.id,
      modality: 'OTHER',
      subMode: 'LORE_JSON',
      title: 'Gacha Aura Table',
      assetGroupId: 'grp_anime_other_gacha_json',
      version: 1,
      batchIndex: 0,
      rawPrompt: jobGachaJson.rawPrompt,
      enhancedPrompt: gachaTableCompiled.enhancedPrompt,
      negativePrompt: '',
      approval: 'APPROVED',
      isFavorite: false,
      tags: ['json', 'gacha', 'auras', 'table'],
      notes: '',
      metadata: {
        modality: 'OTHER',
        subMode: 'LORE_JSON',
        schemaKind: 'ITEM_TABLE',
        lineCount: gachaJsonRes.lineCount,
      },
      providerConfigId: providers.demo.id,
      providerKind: 'DEMO',
      providerModel: 'forge-demo-synth-v1',
      tier: 'LOCAL',
      costUsd: 0,
      executionMs: 490,
      seed: seedGachaJson,
      createdAt: jobGachaJson.completedAt!,
    },
  });
  const gachaJsonKey = StorageKeys.assetFile(
    anime.project.id,
    'OTHER',
    gachaJsonAsset.id,
    1,
    'gacha-auras.json',
  );
  const gachaJsonBuf = Buffer.from(gachaJsonRes.jsonText, 'utf8');
  const gachaJsonSt = await ctx.storage.putBuffer(gachaJsonKey, gachaJsonBuf, 'application/json');
  ctx.recordBytes(gachaJsonSt.sizeBytes);
  await ctx.prisma.generatedAssetFile.create({
    data: {
      assetId: gachaJsonAsset.id,
      role: 'PRIMARY',
      storageKey: gachaJsonKey,
      fileName: 'gacha-auras.json',
      mimeType: 'application/json',
      sizeBytes: gachaJsonSt.sizeBytes,
      format: 'json',
      sortIndex: 0,
    },
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // ADDITIONAL JOB STATES FOR UI DEMONSTRATION (Astra Project — Jobs 37, 38, 39)
  // ═══════════════════════════════════════════════════════════════════════════

  // 37: AWAITING_REVIEW INTERCEPT job (ICONS_2D)
  jobCounter++;
  const interceptTime = jobTimestamp(jobCounter);
  const interceptCompiled: CompiledPrompt = {
    assetTitle: "Solaris Katana of Lyra's Crown",
    enhancedPrompt:
      'Single centered legendary fire katana icon at a 35-degree clockwise 3/4 angle, filling 75% of canvas · Forged Night Indigo #1B1446 blade wreathed in Ember Coral #FF6B5A solar flames, oversized 1.2x Starlight Gold #F5C451 crescent crossguard with faceted star-crystal core, Moon Ivory #F4EFE6 grip · Crisp Nebula Cyan #3CD3F0 upper-left rim light · Painterly cel-shaded two-tone shadows, transparent background.',
    negativePrompt: middleman.templatesByModality.ICONS_2D.defaultNegativePrompt,
    recommendedParams: { outputSize: 1024, removeBackground: true },
    contextSourcesUsed: buildSources(astra, [
      'Art Bible.md',
      'Color Palette.md',
      'Icon Style Guide.md',
      'Naming Conventions.md',
    ]),
    warnings: [],
  };
  const jobIntercept = await ctx.prisma.generationJob.create({
    data: {
      projectId: astra.project.id,
      modality: 'ICONS_2D',
      subMode: 'STANDARD',
      executionMode: 'INTERCEPT',
      status: 'AWAITING_REVIEW',
      rawPrompt: 'A legendary fire katana icon',
      pinnedFileIds: [astra.filesByName['Icon Style Guide.md']!.id],
      userParams: defaultParamsFor('ICONS_2D') as unknown as Prisma.InputJsonValue,
      referenceStorageKeys: [],
      skipMiddleman: false,
      middlemanProfileId: middleman.defaultProfile.id,
      middlemanTemplateId: middleman.templatesByModality.ICONS_2D.id,
      middlemanRawOutput: JSON.stringify(interceptCompiled, null, 2),
      compiledPayload: interceptCompiled as unknown as Prisma.InputJsonValue,
      contextFileIds: interceptCompiled.contextSourcesUsed.map((c) => c.fileId),
      middlemanUsage: {
        inputTokens: 1510,
        outputTokens: 325,
        latencyMs: 590,
        model: middleman.defaultProfile.model,
      },
      middlemanStartedAt: new Date(interceptTime.getTime() + 200),
      middlemanCompletedAt: new Date(interceptTime.getTime() + 790),
      providerConfigId: providers.demo.id,
      providerModel: 'forge-demo-synth-v1',
      tier: 'LOCAL',
      seed: ctx.nextSeedInt(),
      batchCount: 1,
      progressPercent: 25,
      progressStage: 'awaiting-review',
      createdAt: interceptTime,
    },
  });
  await ctx.prisma.generationJobEvent.createMany({
    data: [
      {
        jobId: jobIntercept.id,
        type: 'status',
        fromStatus: null,
        toStatus: 'QUEUED',
        message: 'Intercept job created and queued',
        payload: {},
        createdAt: interceptTime,
      },
      {
        jobId: jobIntercept.id,
        type: 'status',
        fromStatus: 'QUEUED',
        toStatus: 'COMPILING',
        message: 'Middleman prompt compilation started',
        payload: {},
        createdAt: new Date(interceptTime.getTime() + 200),
      },
      {
        jobId: jobIntercept.id,
        type: 'status',
        fromStatus: 'COMPILING',
        toStatus: 'AWAITING_REVIEW',
        message: 'Compiled prompt ready for artist review in Intercept drawer',
        payload: {},
        createdAt: new Date(interceptTime.getTime() + 790),
      },
    ],
  });

  // 38: FAILED job (ASSETS_3D, Tripo3D †, PROVIDER_AUTH_FAILED)
  jobCounter++;
  const failedTime = jobTimestamp(jobCounter);
  const failedCompiled: CompiledPrompt = {
    assetTitle: 'Shattered Veil Astrolabe',
    enhancedPrompt:
      'Isolated 3D celestial astrolabe prop with concentric Starlight Gold #F5C451 rings and Astral Violet #7C3AED core crystal, LOW_POLY watertight mesh.',
    negativePrompt: middleman.templatesByModality.ASSETS_3D.defaultNegativePrompt,
    recommendedParams: { target_polycount: 5000, texture_resolution: 2048 },
    contextSourcesUsed: buildSources(astra, ['3D Asset Standards.md', 'Color Palette.md']),
    warnings: [],
  };
  const jobFailed = await ctx.prisma.generationJob.create({
    data: {
      projectId: astra.project.id,
      modality: 'ASSETS_3D',
      subMode: 'TEXT_TO_3D',
      executionMode: 'AUTO_FIRE',
      status: 'FAILED',
      rawPrompt: '3D Shattered Veil Astrolabe relic prop',
      pinnedFileIds: [],
      userParams: defaultParamsFor('ASSETS_3D') as unknown as Prisma.InputJsonValue,
      referenceStorageKeys: [],
      skipMiddleman: false,
      middlemanProfileId: middleman.defaultProfile.id,
      middlemanTemplateId: middleman.templatesByModality.ASSETS_3D.id,
      middlemanRawOutput: JSON.stringify(failedCompiled, null, 2),
      compiledPayload: failedCompiled as unknown as Prisma.InputJsonValue,
      contextFileIds: failedCompiled.contextSourcesUsed.map((c) => c.fileId),
      middlemanStartedAt: new Date(failedTime.getTime() + 180),
      middlemanCompletedAt: new Date(failedTime.getTime() + 720),
      providerConfigId: providers.tripo3d.id,
      providerModel: 'default',
      tier: 'CLOUD_API',
      seed: ctx.nextSeedInt(),
      batchCount: 1,
      progressPercent: 0,
      progressStage: 'failed',
      errorCode: 'PROVIDER_AUTH_FAILED',
      errorMessage: 'Tripo3D rejected the API key (401)',
      createdAt: failedTime,
      dispatchedAt: new Date(failedTime.getTime() + 900),
      completedAt: new Date(failedTime.getTime() + 1450),
    },
  });
  await ctx.prisma.generationJobEvent.createMany({
    data: [
      {
        jobId: jobFailed.id,
        type: 'status',
        fromStatus: null,
        toStatus: 'QUEUED',
        message: 'Job queued',
        payload: {},
        createdAt: failedTime,
      },
      {
        jobId: jobFailed.id,
        type: 'status',
        fromStatus: 'QUEUED',
        toStatus: 'COMPILING',
        message: 'Compiling with Middleman',
        payload: {},
        createdAt: new Date(failedTime.getTime() + 180),
      },
      {
        jobId: jobFailed.id,
        type: 'status',
        fromStatus: 'COMPILING',
        toStatus: 'READY',
        message: 'Compilation succeeded',
        payload: {},
        createdAt: new Date(failedTime.getTime() + 720),
      },
      {
        jobId: jobFailed.id,
        type: 'status',
        fromStatus: 'READY',
        toStatus: 'DISPATCHING',
        message: 'Dispatching to Tripo3D',
        payload: {},
        createdAt: new Date(failedTime.getTime() + 900),
      },
      {
        jobId: jobFailed.id,
        type: 'status',
        fromStatus: 'DISPATCHING',
        toStatus: 'FAILED',
        message: 'Tripo3D rejected the API key (401)',
        payload: { errorCode: 'PROVIDER_AUTH_FAILED' },
        createdAt: new Date(failedTime.getTime() + 1450),
      },
    ],
  });

  // 39: CANCELLED job (MUSIC)
  jobCounter++;
  const cancelledTime = jobTimestamp(jobCounter);
  const cancelledCompiled: CompiledPrompt = {
    assetTitle: 'Sunken Sanctum Ambience',
    enhancedPrompt:
      'Underwater dream-zone ambient music at 74 BPM in A Aeolian, muffled low-pass percussion, glass harmonica textures and choir pads, 60 seconds seamless loop.',
    negativePrompt: middleman.templatesByModality.MUSIC.defaultNegativePrompt,
    recommendedParams: { bpm: 74, key_signature: 'A Aeolian', duration_seconds: 60, loop: true },
    contextSourcesUsed: buildSources(astra, ['Music Direction.md']),
    warnings: [],
  };
  const jobCancelled = await ctx.prisma.generationJob.create({
    data: {
      projectId: astra.project.id,
      modality: 'MUSIC',
      subMode: 'STANDARD',
      executionMode: 'AUTO_FIRE',
      status: 'CANCELLED',
      rawPrompt: 'Underwater dream zone ambient music at 74 BPM',
      pinnedFileIds: [],
      userParams: {
        ...defaultParamsFor('MUSIC'),
        trackType: 'AMBIENT',
        bpm: 74,
      } as unknown as Prisma.InputJsonValue,
      referenceStorageKeys: [],
      skipMiddleman: false,
      middlemanProfileId: middleman.defaultProfile.id,
      middlemanTemplateId: middleman.templatesByModality.MUSIC.id,
      middlemanRawOutput: JSON.stringify(cancelledCompiled, null, 2),
      compiledPayload: cancelledCompiled as unknown as Prisma.InputJsonValue,
      contextFileIds: cancelledCompiled.contextSourcesUsed.map((c) => c.fileId),
      middlemanStartedAt: new Date(cancelledTime.getTime() + 150),
      middlemanCompletedAt: new Date(cancelledTime.getTime() + 680),
      providerConfigId: providers.demo.id,
      providerModel: 'forge-demo-synth-v1',
      tier: 'LOCAL',
      seed: ctx.nextSeedInt(),
      batchCount: 1,
      progressPercent: 45,
      progressStage: 'cancelled',
      createdAt: cancelledTime,
      dispatchedAt: new Date(cancelledTime.getTime() + 800),
      startedAt: new Date(cancelledTime.getTime() + 950),
      completedAt: new Date(cancelledTime.getTime() + 1800),
    },
  });
  await ctx.prisma.generationJobEvent.createMany({
    data: [
      {
        jobId: jobCancelled.id,
        type: 'status',
        fromStatus: null,
        toStatus: 'QUEUED',
        message: 'Job queued',
        payload: {},
        createdAt: cancelledTime,
      },
      {
        jobId: jobCancelled.id,
        type: 'status',
        fromStatus: 'QUEUED',
        toStatus: 'COMPILING',
        message: 'Compiling prompt',
        payload: {},
        createdAt: new Date(cancelledTime.getTime() + 150),
      },
      {
        jobId: jobCancelled.id,
        type: 'status',
        fromStatus: 'COMPILING',
        toStatus: 'READY',
        message: 'Compiled prompt ready',
        payload: {},
        createdAt: new Date(cancelledTime.getTime() + 680),
      },
      {
        jobId: jobCancelled.id,
        type: 'status',
        fromStatus: 'READY',
        toStatus: 'DISPATCHING',
        message: 'Dispatching job',
        payload: {},
        createdAt: new Date(cancelledTime.getTime() + 800),
      },
      {
        jobId: jobCancelled.id,
        type: 'status',
        fromStatus: 'DISPATCHING',
        toStatus: 'RUNNING',
        message: 'Synthesizing audio track',
        payload: {},
        createdAt: new Date(cancelledTime.getTime() + 950),
      },
      {
        jobId: jobCancelled.id,
        type: 'status',
        fromStatus: 'RUNNING',
        toStatus: 'CANCELLED',
        message: 'Cancelled by user request',
        payload: {},
        createdAt: new Date(cancelledTime.getTime() + 1800),
      },
    ],
  });
}
