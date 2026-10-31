import * as path from 'node:path';
import {
  AssetFileRole,
  AssetListQueryDto,
  AssetModel,
  ErrorCode,
  estimateTokens,
  ExecutionMode,
  JobModel,
  JobStatus,
  Paginated,
  SaveAssetToVaultDto,
  SEED_MAX,
  UpdateAssetDto,
  VaultFileKind,
  VaultFileModel,
  VisionStatus,
} from '@forge/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toAssetModel } from '../common/mappers/asset.mapper';
import { toJobModel } from '../common/mappers/job.mapper';
import { toVaultFileModel } from '../common/mappers/vault.mapper';
import { sha256Hex } from '../common/utils/sha256';
import { JobProcessorService } from '../generators/job-processor.service';
import { editWavAudio } from '../synth/wav-audio.synth';
import {
  JOB_EVENTS_PUBLISHER,
  JobEventsPublisherPort,
} from '../orchestrator/job-events.port';
import { PrismaService } from '../prisma/prisma.service';
import { kindFromNameAndMime } from '../projects-vault/vault-files.service';
import { VisionAnalysisService } from '../projects-vault/vision-analysis.service';
import { ImageProcessingService } from '../storage/image-processing.service';
import { StorageKeys } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';

const ASSET_INCLUDE = {
  files: true,
  savedToVault: {
    select: { id: true },
  },
} as const;

@Injectable()
export class AssetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly imageProc: ImageProcessingService,
    private readonly visionAnalysis: VisionAnalysisService,
    private readonly processor: JobProcessorService,
    @Inject(JOB_EVENTS_PUBLISHER)
    private readonly eventsPublisher: JobEventsPublisherPort,
  ) {}

  async list(query: AssetListQueryDto): Promise<Paginated<AssetModel>> {
    const where: Prisma.GeneratedAssetWhereInput = {
      projectId: query.projectId,
    };

    if (query.modality) {
      where.modality = query.modality;
    }
    if (query.approval) {
      where.approval = query.approval;
    }
    if (query.favorite === 'true') {
      where.isFavorite = true;
    } else if (query.favorite === 'false') {
      where.isFavorite = false;
    }
    if (query.tier) {
      where.tier = query.tier;
    }
    if (query.q && query.q.trim().length > 0) {
      const q = query.q.trim();
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { rawPrompt: { contains: q, mode: 'insensitive' } },
        { enhancedPrompt: { contains: q, mode: 'insensitive' } },
        { tags: { has: q } },
      ];
    }

    let orderBy: Prisma.GeneratedAssetOrderByWithRelationInput[];
    if (query.sort === 'oldest') {
      orderBy = [{ createdAt: 'asc' }, { id: 'asc' }];
    } else if (query.sort === 'cost') {
      orderBy = [{ costUsd: 'desc' }, { createdAt: 'desc' }];
    } else if (query.sort === 'duration') {
      orderBy = [{ executionMs: 'desc' }, { createdAt: 'desc' }];
    } else {
      orderBy = [{ createdAt: 'desc' }, { id: 'desc' }];
    }

    const limit = query.limit ?? 40;
    const [rows, total] = await Promise.all([
      this.prisma.generatedAsset.findMany({
        where,
        orderBy,
        take: limit + 1,
        ...(query.cursor
          ? {
              cursor: { id: query.cursor },
              skip: 1,
            }
          : {}),
        include: ASSET_INCLUDE,
      }),
      this.prisma.generatedAsset.count({ where }),
    ]);

    const providerMap = await this.buildProviderNameMap(
      rows
        .map((r) => r.providerConfigId)
        .filter((id): id is string => typeof id === 'string'),
    );

    const hasMore = rows.length > limit;
    const sliced = hasMore ? rows.slice(0, limit) : rows;
    const items = sliced.map((r) => toAssetModel(r, providerMap));
    const nextCursor = hasMore ? (items[items.length - 1]?.id ?? null) : null;

    return { items, nextCursor, total };
  }

  async get(id: string): Promise<AssetModel & { lineage: AssetModel[] }> {
    const row = await this.prisma.generatedAsset.findUnique({
      where: { id },
      include: ASSET_INCLUDE,
    });
    if (!row) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Asset not found: ${id}`);
    }

    const lineageRows = await this.prisma.generatedAsset.findMany({
      where: { assetGroupId: row.assetGroupId },
      orderBy: [{ version: 'asc' }, { createdAt: 'asc' }],
      include: ASSET_INCLUDE,
    });

    const providerIds = [
      row.providerConfigId,
      ...lineageRows.map((r) => r.providerConfigId),
    ].filter((pid): pid is string => typeof pid === 'string');
    const providerMap = await this.buildProviderNameMap(providerIds);

    const baseModel = toAssetModel(row, providerMap);
    const lineage = lineageRows.map((r) => toAssetModel(r, providerMap));

    return {
      ...baseModel,
      lineage,
    };
  }

  async update(id: string, dto: UpdateAssetDto): Promise<AssetModel> {
    const existing = await this.prisma.generatedAsset.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Asset not found: ${id}`);
    }

    const updated = await this.prisma.generatedAsset.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.approval !== undefined ? { approval: dto.approval } : {}),
        ...(dto.isFavorite !== undefined ? { isFavorite: dto.isFavorite } : {}),
        ...(dto.tags !== undefined ? { tags: dto.tags } : {}),
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
      },
      include: ASSET_INCLUDE,
    });

    const providerMap = await this.buildProviderNameMap(
      updated.providerConfigId ? [updated.providerConfigId] : [],
    );

    return toAssetModel(updated, providerMap);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.prisma.generatedAsset.findUnique({
      where: { id },
      include: { files: true },
    });
    if (!existing) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Asset not found: ${id}`);
    }

    await this.prisma.generatedAsset.delete({ where: { id } });

    for (const f of existing.files) {
      await this.storage.delete(f.storageKey).catch(() => undefined);
    }
  }

  async saveToVault(
    id: string,
    dto: SaveAssetToVaultDto,
  ): Promise<VaultFileModel> {
    const asset = await this.prisma.generatedAsset.findUnique({
      where: { id },
      include: {
        files: true,
        project: true,
        savedToVault: { select: { id: true } },
      },
    });
    if (!asset) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Asset not found: ${id}`);
    }

    if (asset.savedToVault) {
      const existingVault = await this.prisma.vaultFile.findUnique({
        where: { id: asset.savedToVault.id },
        include: { folder: { select: { path: true } } },
      });
      if (existingVault) {
        return toVaultFileModel(existingVault);
      }
    }

    const folder = await this.prisma.vaultFolder.findUnique({
      where: { id: dto.folderId },
    });
    if (!folder || folder.projectId !== asset.projectId) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Vault folder not found in project: ${dto.folderId}`,
      );
    }

    const targetFile =
      asset.files.find((f) => f.role === dto.fileRole) ??
      asset.files.find((f) => f.role === AssetFileRole.PRIMARY) ??
      asset.files[0];

    if (!targetFile) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Asset ${id} has no files to copy into the vault`,
      );
    }

    const fileBuf = await this.storage.getBuffer(targetFile.storageKey);
    const ext =
      path.extname(targetFile.fileName).replace(/^\./, '').toLowerCase() ||
      targetFile.format ||
      'bin';
    const baseSafeTitle = asset.title
      .replace(/[^\w\s-]/g, '')
      .trim()
      .replace(/\s+/g, '_');
    const desiredName = `${baseSafeTitle || 'asset'}.${ext}`;

    // Resolve unique name in target folder
    let finalName = desiredName;
    let suffixIdx = 2;
    while (true) {
      const dup = await this.prisma.vaultFile.findUnique({
        where: {
          folderId_name: {
            folderId: folder.id,
            name: finalName,
          },
        },
      });
      if (!dup) break;
      finalName = `${baseSafeTitle || 'asset'} (${suffixIdx++}).${ext}`;
    }

    const kind = kindFromNameAndMime(finalName, targetFile.mimeType);
    const isTextKind =
      kind === VaultFileKind.MARKDOWN ||
      kind === VaultFileKind.TEXT ||
      kind === VaultFileKind.JSON;
    const contentText = isTextKind ? fileBuf.toString('utf8') : null;
    const tokenEstimate = contentText ? estimateTokens(contentText) : 0;
    const shouldRunVision = kind === VaultFileKind.IMAGE && dto.runVision;

    const created = await this.prisma.vaultFile.create({
      data: {
        projectId: asset.projectId,
        folderId: folder.id,
        name: finalName,
        extension: ext,
        kind,
        mimeType: targetFile.mimeType,
        sizeBytes: fileBuf.length,
        checksumSha256: sha256Hex(fileBuf),
        contentText,
        scopes: dto.scopes,
        priority: 70,
        description: `Saved from generated asset "${asset.title}" (v${asset.version})`,
        tokenEstimate,
        width: targetFile.width,
        height: targetFile.height,
        durationMs: targetFile.durationMs,
        metadata: {
          ...(typeof asset.metadata === 'object' && asset.metadata !== null
            ? (asset.metadata as Record<string, unknown>)
            : {}),
          enhancedPrompt: asset.enhancedPrompt,
          rawPrompt: asset.rawPrompt,
          tags: asset.tags,
          notes: asset.notes,
        } as unknown as Prisma.InputJsonValue,
        visionStatus: shouldRunVision
          ? VisionStatus.PENDING
          : VisionStatus.NONE,
        sourceAssetId: asset.id,
      },
    });

    const vaultStorageKey = StorageKeys.vaultFile(
      asset.project.slug,
      created.id,
      finalName,
    );
    await this.storage.putBuffer(
      vaultStorageKey,
      fileBuf,
      targetFile.mimeType,
    );

    let thumbnailKey: string | null = null;
    if (kind === VaultFileKind.IMAGE) {
      try {
        const thumbBuf = await this.imageProc.thumbnail(fileBuf, 384);
        thumbnailKey = StorageKeys.vaultThumb(asset.project.slug, created.id);
        await this.storage.putBuffer(thumbnailKey, thumbBuf, 'image/webp');
      } catch {
        thumbnailKey = null;
      }
    }

    const finalized = await this.prisma.vaultFile.update({
      where: { id: created.id },
      data: {
        storageKey: vaultStorageKey,
        thumbnailKey,
      },
      include: {
        folder: { select: { path: true } },
      },
    });

    const model = toVaultFileModel(finalized);
    this.eventsPublisher.vaultFileUpdated({
      projectId: asset.projectId,
      file: model,
    });

    if (shouldRunVision) {
      this.visionAnalysis.enqueue(finalized.id);
    }

    return model;
  }

  async createVariation(
    id: string,
    executionMode: ExecutionMode = ExecutionMode.AUTO_FIRE,
  ): Promise<JobModel> {
    const asset = await this.prisma.generatedAsset.findUnique({
      where: { id },
      include: {
        job: true,
      },
    });
    if (!asset) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Asset not found: ${id}`);
    }

    let providerConfigId = asset.providerConfigId ?? asset.job?.providerConfigId;
    if (!providerConfigId) {
      const fallbackProvider = await this.prisma.aiProviderConfig.findFirst({
        where: {
          isEnabled: true,
          modalities: { has: asset.modality },
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!fallbackProvider) {
        throw new DomainError(
          ErrorCode.PROVIDER_NOT_CONFIGURED,
          400,
          `No enabled provider available for modality ${asset.modality}`,
        );
      }
      providerConfigId = fallbackProvider.id;
    }

    const newSeed = Math.floor(Math.random() * SEED_MAX);
    const baseUserParams =
      asset.job &&
      typeof asset.job.userParams === 'object' &&
      asset.job.userParams !== null
        ? {
            ...(asset.job.userParams as Record<string, unknown>),
            seed: newSeed,
            __parentAssetId: asset.id,
          }
        : {
            modality: asset.modality,
            subMode: asset.subMode,
            seed: newSeed,
            __parentAssetId: asset.id,
          };

    const created = await this.prisma.$transaction(async (tx) => {
      const job = await tx.generationJob.create({
        data: {
          projectId: asset.projectId,
          modality: asset.modality,
          subMode: asset.subMode,
          executionMode,
          status: JobStatus.QUEUED,
          rawPrompt: asset.rawPrompt,
          pinnedFileIds: asset.job?.pinnedFileIds ?? [],
          referenceStorageKeys: asset.job?.referenceStorageKeys ?? [],
          userParams: baseUserParams as Prisma.InputJsonValue,
          middlemanProfileId: asset.job?.middlemanProfileId ?? null,
          skipMiddleman: false,
          compiledPayload:
            asset.job?.compiledPayload !== null &&
            asset.job?.compiledPayload !== undefined
              ? (asset.job.compiledPayload as Prisma.InputJsonValue)
              : Prisma.JsonNull,
          providerConfigId,
          providerModel: asset.providerModel,
          tier: asset.tier,
          seed: newSeed,
          batchCount: 1,
          parentJobId: asset.jobId,
        },
        include: {
          providerConfig: {
            select: { id: true, name: true, kind: true },
          },
          middlemanProfile: {
            select: { id: true, name: true },
          },
          assets: {
            select: { id: true },
          },
        },
      });

      await tx.generationJobEvent.create({
        data: {
          jobId: job.id,
          type: 'created',
          fromStatus: null,
          toStatus: JobStatus.QUEUED,
          message: `Variation created from asset "${asset.title}" (v${asset.version})`,
        },
      });

      return job;
    });

    const model = toJobModel(created);
    this.eventsPublisher.jobCreated({ job: model });
    void this.processor.tick();
    return model;
  }

  async remapPalette(
    id: string,
    dto: { targetPaletteHex?: string[]; strength?: number } = {},
  ): Promise<AssetModel> {
    const asset = await this.prisma.generatedAsset.findUnique({
      where: { id },
      include: {
        files: true,
        project: true,
      },
    });
    if (!asset) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Asset not found: ${id}`);
    }
    if (asset.modality !== 'ICONS_2D' && asset.modality !== 'IMAGES') {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        `Palette remap is only supported for ICONS_2D and IMAGES assets (got ${asset.modality})`,
      );
    }

    const primaryFile =
      asset.files.find((f) => f.role === AssetFileRole.PRIMARY) ??
      asset.files[0];
    if (!primaryFile) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Asset ${id} has no primary image file`,
      );
    }

    let palette = (dto.targetPaletteHex ?? []).filter((h) =>
      /^#[0-9A-Fa-f]{6}$/.test(h.trim()),
    );
    if (palette.length === 0) {
      const vaultImages = await this.prisma.vaultFile.findMany({
        where: { projectId: asset.projectId, kind: VaultFileKind.IMAGE },
        select: { styleDescriptorJson: true },
        take: 20,
      });
      const hexSet = new Set<string>();
      for (const vi of vaultImages) {
        const sd =
          typeof vi.styleDescriptorJson === 'object' &&
          vi.styleDescriptorJson !== null
            ? (vi.styleDescriptorJson as Record<string, unknown>)
            : null;
        const pHex = sd?.['paletteHex'];
        if (Array.isArray(pHex)) {
          for (const c of pHex) {
            if (typeof c === 'string' && /^#[0-9A-Fa-f]{6}$/.test(c.trim())) {
              hexSet.add(c.trim().toUpperCase());
            }
          }
        }
      }
      if (hexSet.size === 0 && asset.project.accentHex) {
        hexSet.add(asset.project.accentHex.toUpperCase());
      }
      palette = [...hexSet];
    }

    const rawBuf = await this.storage.getBuffer(primaryFile.storageKey);
    const remappedBuf = await this.imageProc.remapToPalette(
      rawBuf,
      palette,
      dto.strength ?? 0.85,
    );
    const [probe, thumbBuf, compliance] = await Promise.all([
      this.imageProc.probe(remappedBuf),
      this.imageProc.thumbnail(remappedBuf, 384),
      this.imageProc.scorePaletteCompliance(remappedBuf, palette),
    ]);

    const maxVer = await this.prisma.generatedAsset.aggregate({
      where: { assetGroupId: asset.assetGroupId },
      _max: { version: true },
    });
    const nextVersion = (maxVer._max.version ?? asset.version) + 1;
    const newAssetId = `ast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    const primaryKey = StorageKeys.assetFile(
      asset.project.slug,
      asset.modality,
      newAssetId,
      nextVersion,
      'remapped.png',
    );
    const thumbKey = StorageKeys.assetFile(
      asset.project.slug,
      asset.modality,
      newAssetId,
      nextVersion,
      'thumb.webp',
    );
    await Promise.all([
      this.storage.putBuffer(primaryKey, remappedBuf, 'image/png'),
      this.storage.putBuffer(thumbKey, thumbBuf, 'image/webp'),
    ]);

    const prevMeta =
      typeof asset.metadata === 'object' && asset.metadata !== null
        ? (asset.metadata as Record<string, unknown>)
        : {};
    const newMetadata = {
      ...prevMeta,
      paletteScore: compliance.paletteScore,
      dominantHex: compliance.dominantHex,
    };

    const created = await this.prisma.generatedAsset.create({
      data: {
        id: newAssetId,
        projectId: asset.projectId,
        jobId: asset.jobId,
        modality: asset.modality,
        subMode: asset.subMode,
        title: `${asset.title} (Palette Remap)`,
        assetGroupId: asset.assetGroupId,
        version: nextVersion,
        batchIndex: asset.batchIndex,
        parentAssetId: asset.id,
        rawPrompt: asset.rawPrompt,
        enhancedPrompt: asset.enhancedPrompt,
        negativePrompt: asset.negativePrompt,
        providerConfigId: asset.providerConfigId,
        providerKind: asset.providerKind,
        providerModel: asset.providerModel,
        tier: asset.tier,
        seed: asset.seed,
        costUsd: 0,
        executionMs: 0,
        approval: asset.approval,
        isFavorite: asset.isFavorite,
        tags: [...asset.tags, 'palette-remap'],
        notes: asset.notes,
        metadata: newMetadata as unknown as Prisma.InputJsonValue,
        files: {
          create: [
            {
              role: AssetFileRole.PRIMARY,
              storageKey: primaryKey,
              fileName: 'remapped.png',
              mimeType: 'image/png',
              sizeBytes: remappedBuf.length,
              width: probe.width,
              height: probe.height,
              durationMs: null,
              format: 'png',
              sortIndex: 0,
            },
            {
              role: AssetFileRole.THUMBNAIL,
              storageKey: thumbKey,
              fileName: 'thumb.webp',
              mimeType: 'image/webp',
              sizeBytes: thumbBuf.length,
              width: 384,
              height: 384,
              durationMs: null,
              format: 'webp',
              sortIndex: 1,
            },
          ],
        },
      },
      include: ASSET_INCLUDE,
    });

    const providerMap = await this.buildProviderNameMap(
      created.providerConfigId ? [created.providerConfigId] : [],
    );
    return toAssetModel(created, providerMap);
  }

  /**
   * 4.1 In-Stage Text/Code/JSON Revision: saves edited Markdown, Shader Code, or Lore JSON
   * as a new asset version in the same assetGroupId.
   */
  async reviseTextAsset(
    id: string,
    dto: { contentText: string; title?: string; notes?: string },
  ): Promise<AssetModel> {
    const asset = await this.prisma.generatedAsset.findUnique({
      where: { id },
      include: {
        files: true,
        project: true,
      },
    });
    if (!asset) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Asset not found: ${id}`);
    }
    const isTextAsset =
      asset.modality === 'LORE' ||
      (asset.modality === 'OTHER' &&
        (asset.subMode === 'SHADER_CODE' || asset.subMode === 'LORE_JSON'));
    if (!isTextAsset) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        `Text revision is only supported for LORE, SHADER_CODE, and LORE_JSON assets (got ${asset.modality}/${asset.subMode})`,
      );
    }

    if (asset.subMode === 'LORE_JSON') {
      try {
        JSON.parse(dto.contentText);
      } catch (err) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          400,
          `Invalid JSON in LORE_JSON revision: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const primaryFile =
      asset.files.find((f) => f.role === AssetFileRole.PRIMARY) ??
      asset.files[0];
    const fileName = primaryFile?.fileName ?? 'revised.txt';
    const mimeType = primaryFile?.mimeType ?? 'text/plain';
    const format = primaryFile?.format ?? 'txt';
    const buf = Buffer.from(dto.contentText, 'utf8');

    const maxVer = await this.prisma.generatedAsset.aggregate({
      where: { assetGroupId: asset.assetGroupId },
      _max: { version: true },
    });
    const nextVersion = (maxVer._max.version ?? asset.version) + 1;
    const newAssetId = `ast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    const storageKey = StorageKeys.assetFile(
      asset.project.slug,
      asset.modality,
      newAssetId,
      nextVersion,
      fileName,
    );
    await this.storage.putBuffer(storageKey, buf, mimeType);

    const prevMeta =
      typeof asset.metadata === 'object' && asset.metadata !== null
        ? (asset.metadata as Record<string, unknown>)
        : {};
    let newMetadata: Record<string, unknown>;
    if (asset.modality === 'LORE') {
      const words = dto.contentText
        .trim()
        .split(/\s+/)
        .filter((w) => w.length > 0);
      const wordCount = words.length;
      const charCount = dto.contentText.length;
      const readingTimeSec = Math.max(5, Math.round((wordCount / 200) * 60));
      const excerpt = dto.contentText
        .replace(/[#>*_`~-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 220);
      newMetadata = {
        ...prevMeta,
        wordCount,
        charCount,
        readingTimeSec,
        excerpt,
      };
    } else {
      newMetadata = {
        ...prevMeta,
        lineCount: dto.contentText.split(/\r?\n/).length,
      };
    }

    const created = await this.prisma.generatedAsset.create({
      data: {
        id: newAssetId,
        projectId: asset.projectId,
        jobId: asset.jobId,
        modality: asset.modality,
        subMode: asset.subMode,
        title: dto.title?.trim() || `${asset.title} (Edited)`,
        assetGroupId: asset.assetGroupId,
        version: nextVersion,
        batchIndex: asset.batchIndex,
        parentAssetId: asset.id,
        rawPrompt: asset.rawPrompt,
        enhancedPrompt: asset.enhancedPrompt,
        negativePrompt: asset.negativePrompt,
        providerConfigId: asset.providerConfigId,
        providerKind: asset.providerKind,
        providerModel: asset.providerModel,
        tier: asset.tier,
        seed: asset.seed,
        costUsd: 0,
        executionMs: 0,
        approval: asset.approval,
        isFavorite: asset.isFavorite,
        tags: [...new Set([...asset.tags, 'edited'])],
        notes: dto.notes ?? asset.notes,
        metadata: newMetadata as unknown as Prisma.InputJsonValue,
        files: {
          create: [
            {
              role: AssetFileRole.PRIMARY,
              storageKey,
              fileName,
              mimeType,
              sizeBytes: buf.length,
              width: null,
              height: null,
              durationMs: null,
              format,
              sortIndex: 0,
            },
          ],
        },
      },
      include: ASSET_INCLUDE,
    });

    const providerMap = await this.buildProviderNameMap(
      created.providerConfigId ? [created.providerConfigId] : [],
    );
    return toAssetModel(created, providerMap);
  }

  /**
   * 4.3 Audio Trim & Seamless Loop Crossfade: trims start/end and applies equal-power
   * loop crossfading on WAV audio assets, saving a new version in assetGroupId.
   */
  async editAudioAsset(
    id: string,
    dto: {
      trimStartMs?: number;
      trimEndMs?: number;
      crossfadeMs?: number;
      normalizePeakDb?: number;
    },
  ): Promise<AssetModel> {
    const asset = await this.prisma.generatedAsset.findUnique({
      where: { id },
      include: {
        files: true,
        project: true,
      },
    });
    if (!asset) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Asset not found: ${id}`);
    }
    if (
      asset.modality !== 'MUSIC' &&
      asset.modality !== 'SFX' &&
      asset.modality !== 'VOICES'
    ) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        `Audio editing is only supported for MUSIC, SFX, and VOICES assets (got ${asset.modality})`,
      );
    }

    const primaryFile =
      asset.files.find((f) => f.role === AssetFileRole.PRIMARY) ??
      asset.files[0];
    if (!primaryFile) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Asset ${id} has no primary audio file`,
      );
    }

    const rawWav = await this.storage.getBuffer(primaryFile.storageKey);
    const edited = editWavAudio(rawWav, dto);

    const maxVer = await this.prisma.generatedAsset.aggregate({
      where: { assetGroupId: asset.assetGroupId },
      _max: { version: true },
    });
    const nextVersion = (maxVer._max.version ?? asset.version) + 1;
    const newAssetId = `ast_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;

    const storageKey = StorageKeys.assetFile(
      asset.project.slug,
      asset.modality,
      newAssetId,
      nextVersion,
      'audio_edited.wav',
    );
    await this.storage.putBuffer(storageKey, edited.wav, 'audio/wav');

    const prevMeta =
      typeof asset.metadata === 'object' && asset.metadata !== null
        ? (asset.metadata as Record<string, unknown>)
        : {};
    const newMetadata = {
      ...prevMeta,
      durationMs: edited.durationMs,
      sampleRate: edited.sampleRate,
      loopSeamDb: edited.loopSeamDb,
    };

    const created = await this.prisma.generatedAsset.create({
      data: {
        id: newAssetId,
        projectId: asset.projectId,
        jobId: asset.jobId,
        modality: asset.modality,
        subMode: asset.subMode,
        title: `${asset.title} (Loop Crossfaded)`,
        assetGroupId: asset.assetGroupId,
        version: nextVersion,
        batchIndex: asset.batchIndex,
        parentAssetId: asset.id,
        rawPrompt: asset.rawPrompt,
        enhancedPrompt: asset.enhancedPrompt,
        negativePrompt: asset.negativePrompt,
        providerConfigId: asset.providerConfigId,
        providerKind: asset.providerKind,
        providerModel: asset.providerModel,
        tier: asset.tier,
        seed: asset.seed,
        costUsd: 0,
        executionMs: 0,
        approval: asset.approval,
        isFavorite: asset.isFavorite,
        tags: [...new Set([...asset.tags, 'audio-edit'])],
        notes: asset.notes,
        metadata: newMetadata as unknown as Prisma.InputJsonValue,
        files: {
          create: [
            {
              role: AssetFileRole.PRIMARY,
              storageKey,
              fileName: 'audio_edited.wav',
              mimeType: 'audio/wav',
              sizeBytes: edited.wav.length,
              width: null,
              height: null,
              durationMs: edited.durationMs,
              format: 'wav',
              sortIndex: 0,
            },
          ],
        },
      },
      include: ASSET_INCLUDE,
    });

    const providerMap = await this.buildProviderNameMap(
      created.providerConfigId ? [created.providerConfigId] : [],
    );
    return toAssetModel(created, providerMap);
  }

  /**
   * 4.4 PBR Map Derivation: derives Normal and packed Occlusion-Roughness-Metallic (ORM)
   * maps from an IMAGES or OTHER/VFX_TEXTURE asset and attaches them to the asset.
   */
  async derivePbrMaps(
    id: string,
    dto: { normalStrength?: number } = {},
  ): Promise<AssetModel> {
    const asset = await this.prisma.generatedAsset.findUnique({
      where: { id },
      include: {
        files: true,
        project: true,
      },
    });
    if (!asset) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Asset not found: ${id}`);
    }

    const primaryFile =
      asset.files.find((f) => f.role === AssetFileRole.PRIMARY) ??
      asset.files[0];
    if (!primaryFile) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Asset ${id} has no primary image file`,
      );
    }

    const albedoBuf = await this.storage.getBuffer(primaryFile.storageKey);
    const probe = await this.imageProc.probe(albedoBuf);
    const maps = await this.imageProc.derivePbrMaps(
      albedoBuf,
      dto.normalStrength ?? 2.5,
    );

    const normalKey = StorageKeys.assetFile(
      asset.project.slug,
      asset.modality,
      asset.id,
      asset.version,
      'pbr_normal.png',
    );
    const ormKey = StorageKeys.assetFile(
      asset.project.slug,
      asset.modality,
      asset.id,
      asset.version,
      'pbr_orm.png',
    );

    await Promise.all([
      this.storage.putBuffer(normalKey, maps.normalPng, 'image/png'),
      this.storage.putBuffer(ormKey, maps.ormPng, 'image/png'),
    ]);

    const baseSortIdx = asset.files.length;
    await this.prisma.$transaction([
      this.prisma.generatedAssetFile.deleteMany({
        where: {
          assetId: asset.id,
          role: {
            in: [AssetFileRole.TEXTURE_NORMAL, AssetFileRole.TEXTURE_ORM],
          },
        },
      }),
      this.prisma.generatedAssetFile.createMany({
        data: [
          {
            assetId: asset.id,
            role: AssetFileRole.TEXTURE_NORMAL,
            storageKey: normalKey,
            fileName: 'pbr_normal.png',
            mimeType: 'image/png',
            sizeBytes: maps.normalPng.length,
            width: probe.width,
            height: probe.height,
            durationMs: null,
            format: 'png',
            sortIndex: baseSortIdx,
          },
          {
            assetId: asset.id,
            role: AssetFileRole.TEXTURE_ORM,
            storageKey: ormKey,
            fileName: 'pbr_orm.png',
            mimeType: 'image/png',
            sizeBytes: maps.ormPng.length,
            width: probe.width,
            height: probe.height,
            durationMs: null,
            format: 'png',
            sortIndex: baseSortIdx + 1,
          },
        ],
      }),
    ]);

    const refreshed = await this.prisma.generatedAsset.findUniqueOrThrow({
      where: { id: asset.id },
      include: ASSET_INCLUDE,
    });
    const providerMap = await this.buildProviderNameMap(
      refreshed.providerConfigId ? [refreshed.providerConfigId] : [],
    );
    return toAssetModel(refreshed, providerMap);
  }

  private async buildProviderNameMap(
    ids: string[],
  ): Promise<Map<string, string>> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) {
      return new Map();
    }
    const rows = await this.prisma.aiProviderConfig.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    const map = new Map<string, string>();
    for (const r of rows) {
      map.set(r.id, r.name);
    }
    return map;
  }
}
