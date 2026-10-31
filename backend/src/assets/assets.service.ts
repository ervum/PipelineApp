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
