import * as path from 'node:path';
import {
  AnalyzeVisionDto,
  ContextFileRef,
  ContextScope,
  CreateTextFileDto,
  DEFAULT_CONTEXT_TOKEN_BUDGET,
  ErrorCode,
  estimateTokens,
  Modality,
  UpdateVaultFileDto,
  UploadVaultFileFieldsDto,
  VaultFileDetailModel,
  VaultFileKind,
  VaultFileModel,
  VaultSearchQueryDto,
  VisionStatus,
} from '@forge/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../common/errors/domain.error';
import {
  toVaultFileDetailModel,
  toVaultFileModel,
} from '../common/mappers/vault.mapper';
import { UploadedMulterFile } from '../common/types/multer-file.interface';
import { mimeFromFilename } from '../common/utils/mime';
import { sha256Hex } from '../common/utils/sha256';
import { ContextAssemblerService } from '../middleman/context-assembler.service';
import {
  JOB_EVENTS_PUBLISHER,
  JobEventsPublisherPort,
} from '../orchestrator/job-events.port';
import { PrismaService } from '../prisma/prisma.service';
import { ImageProcessingService } from '../storage/image-processing.service';
import { StorageKeys } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import { VaultContextService } from './vault-context.service';
import { VisionAnalysisService } from './vision-analysis.service';

export function kindFromNameAndMime(name: string, mime = ''): VaultFileKind {
  const ext = path.extname(name).toLowerCase();
  if (ext === '.md' || ext === '.markdown') return VaultFileKind.MARKDOWN;
  if (ext === '.txt') return VaultFileKind.TEXT;
  if (ext === '.json') return VaultFileKind.JSON;
  if (
    ext === '.glb' ||
    ext === '.gltf' ||
    ext === '.fbx' ||
    ext === '.obj'
  ) {
    return VaultFileKind.MODEL_3D;
  }
  if (
    mime.startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)
  ) {
    return VaultFileKind.IMAGE;
  }
  if (
    mime.startsWith('audio/') ||
    ['.wav', '.mp3', '.ogg', '.flac'].includes(ext)
  ) {
    return VaultFileKind.AUDIO;
  }
  return VaultFileKind.OTHER;
}

function parseWavDurationMs(buf: Buffer): number | null {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }
  const byteRate = buf.readUInt32LE(28);
  const dataSize = buf.readUInt32LE(40);
  if (byteRate <= 0) return null;
  return Math.round((dataSize / byteRate) * 1000);
}

@Injectable()
export class VaultFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly imageProcessing: ImageProcessingService,
    private readonly vaultContext: VaultContextService,
    private readonly contextAssembler: ContextAssemblerService,
    private readonly visionAnalysis: VisionAnalysisService,
    @Inject(JOB_EVENTS_PUBLISHER) private readonly events: JobEventsPublisherPort,
  ) {}

  async list(
    projectId: string,
    filters: { folderId?: string; scope?: ContextScope; kind?: VaultFileKind },
  ): Promise<VaultFileModel[]> {
    const rows = await this.prisma.vaultFile.findMany({
      where: {
        projectId,
        ...(filters.folderId ? { folderId: filters.folderId } : {}),
        ...(filters.scope ? { scopes: { has: filters.scope } } : {}),
        ...(filters.kind ? { kind: filters.kind } : {}),
      },
      include: { folder: { select: { path: true } } },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toVaultFileModel);
  }

  async search(projectId: string, query: VaultSearchQueryDto): Promise<VaultFileModel[]> {
    const q = query.q.trim();
    const where: Prisma.VaultFileWhereInput = {
      projectId,
      ...(query.scope ? { scopes: { has: query.scope } } : {}),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(q.length > 0
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' } },
              { contentText: { contains: q, mode: 'insensitive' } },
              { styleDescriptorText: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.vaultFile.findMany({
      where,
      include: { folder: { select: { path: true } } },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
      take: query.limit,
    });
    return rows.map(toVaultFileModel);
  }

  async get(fileId: string): Promise<VaultFileDetailModel> {
    const row = await this.prisma.vaultFile.findUnique({
      where: { id: fileId },
      include: { folder: { select: { path: true } } },
    });
    if (!row) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Vault file not found: ${fileId}`);
    }
    return toVaultFileDetailModel(row);
  }

  async createText(projectId: string, dto: CreateTextFileDto): Promise<VaultFileDetailModel> {
    const folder = await this.prisma.vaultFolder.findUnique({ where: { id: dto.folderId } });
    if (!folder || folder.projectId !== projectId) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Vault folder ${dto.folderId} not found in project ${projectId}`,
      );
    }

    const finalName = await this.resolveUniqueName(dto.folderId, dto.name);
    const kind = kindFromNameAndMime(finalName);
    if (kind === VaultFileKind.JSON) {
      try {
        JSON.parse(dto.contentText);
      } catch (err) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          400,
          `Invalid JSON content: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const ext = path.extname(finalName).replace(/^\./, '').toLowerCase();
    const mimeType = mimeFromFilename(finalName);
    const buf = Buffer.from(dto.contentText, 'utf8');
    const tokenEstimate = estimateTokens(dto.contentText);

    const created = await this.prisma.vaultFile.create({
      data: {
        projectId,
        folderId: dto.folderId,
        name: finalName,
        extension: ext,
        kind,
        mimeType,
        sizeBytes: buf.length,
        checksumSha256: sha256Hex(buf),
        contentText: dto.contentText,
        scopes: dto.scopes,
        priority: dto.priority,
        description: dto.description,
        tokenEstimate,
      },
      include: { folder: { select: { path: true } } },
    });

    const storageKey = StorageKeys.vaultFile(projectId, created.id, finalName);
    await this.storage.putBuffer(storageKey, buf, mimeType);
    const updatedWithKey = await this.prisma.vaultFile.update({
      where: { id: created.id },
      data: { storageKey },
      include: { folder: { select: { path: true } } },
    });

    this.events.vaultFileUpdated({
      projectId,
      file: toVaultFileModel(updatedWithKey),
    });

    return toVaultFileDetailModel(updatedWithKey);
  }

  async upload(
    projectId: string,
    file: UploadedMulterFile | undefined,
    fields: UploadVaultFileFieldsDto,
  ): Promise<VaultFileDetailModel> {
    if (!file || !file.buffer) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 400, 'Uploaded file is required');
    }

    const folder = await this.prisma.vaultFolder.findUnique({
      where: { id: fields.folderId },
    });
    if (!folder || folder.projectId !== projectId) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Folder ${fields.folderId} not found in project ${projectId}`,
      );
    }

    const origName = file.originalname || 'uploaded-file';
    const finalName = await this.resolveUniqueName(fields.folderId, origName);
    const ext = path.extname(finalName).replace(/^\./, '').toLowerCase();
    const mimeType = file.mimetype || mimeFromFilename(finalName);
    const kind = kindFromNameAndMime(finalName, mimeType);

    let contentText: string | null = null;
    let tokenEstimate = 0;
    let width: number | null = null;
    let height: number | null = null;
    let durationMs: number | null = null;

    if (
      kind === VaultFileKind.MARKDOWN ||
      kind === VaultFileKind.TEXT ||
      kind === VaultFileKind.JSON
    ) {
      const decodedText = file.buffer.toString('utf8');
      if (kind === VaultFileKind.JSON) {
        try {
          JSON.parse(decodedText);
        } catch (err) {
          throw new DomainError(
            ErrorCode.VALIDATION_FAILED,
            400,
            `Uploaded JSON file is invalid: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      contentText = decodedText;
      tokenEstimate = estimateTokens(decodedText);
    } else if (kind === VaultFileKind.IMAGE) {
      const probe = await this.imageProcessing.probe(file.buffer);
      width = probe.width;
      height = probe.height;
    } else if (kind === VaultFileKind.AUDIO) {
      durationMs = parseWavDurationMs(file.buffer);
    }

    const shouldRunVision = kind === VaultFileKind.IMAGE && fields.runVision;

    const created = await this.prisma.vaultFile.create({
      data: {
        projectId,
        folderId: fields.folderId,
        name: finalName,
        extension: ext,
        kind,
        mimeType,
        sizeBytes: file.buffer.length,
        checksumSha256: sha256Hex(file.buffer),
        contentText,
        scopes: fields.scopes,
        priority: fields.priority,
        tokenEstimate,
        width,
        height,
        durationMs,
        visionStatus: shouldRunVision ? VisionStatus.PENDING : VisionStatus.NONE,
      },
    });

    const storageKey = StorageKeys.vaultFile(projectId, created.id, finalName);
    await this.storage.putBuffer(storageKey, file.buffer, mimeType);

    let thumbnailKey: string | null = null;
    if (kind === VaultFileKind.IMAGE) {
      try {
        const thumbBuf = await this.imageProcessing.thumbnail(file.buffer, 384);
        thumbnailKey = StorageKeys.vaultThumb(projectId, created.id);
        await this.storage.putBuffer(thumbnailKey, thumbBuf, 'image/webp');
      } catch {
        thumbnailKey = null;
      }
    }

    const finalized = await this.prisma.vaultFile.update({
      where: { id: created.id },
      data: { storageKey, thumbnailKey },
      include: { folder: { select: { path: true } } },
    });

    this.events.vaultFileUpdated({
      projectId,
      file: toVaultFileModel(finalized),
    });

    if (shouldRunVision) {
      this.visionAnalysis.enqueue(finalized.id);
    }

    return toVaultFileDetailModel(finalized);
  }

  async update(fileId: string, dto: UpdateVaultFileDto): Promise<VaultFileDetailModel> {
    const existing = await this.prisma.vaultFile.findUnique({
      where: { id: fileId },
      include: { folder: { select: { path: true } } },
    });
    if (!existing) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Vault file not found: ${fileId}`);
    }

    let targetFolderId = existing.folderId;
    if (dto.folderId && dto.folderId !== existing.folderId) {
      const folder = await this.prisma.vaultFolder.findUnique({ where: { id: dto.folderId } });
      if (!folder || folder.projectId !== existing.projectId) {
        throw new DomainError(ErrorCode.NOT_FOUND, 404, 'Target folder not found in project');
      }
      targetFolderId = folder.id;
    }

    let targetName = existing.name;
    if (dto.name && dto.name !== existing.name) {
      targetName = await this.resolveUniqueName(targetFolderId, dto.name, fileId);
    } else if (targetFolderId !== existing.folderId) {
      targetName = await this.resolveUniqueName(targetFolderId, existing.name, fileId);
    }

    let contentText = existing.contentText;
    let sizeBytes = existing.sizeBytes;
    let checksumSha256 = existing.checksumSha256;
    let tokenEstimate = existing.tokenEstimate;

    if (dto.contentText !== undefined) {
      if (existing.kind === VaultFileKind.JSON) {
        try {
          JSON.parse(dto.contentText);
        } catch (err) {
          throw new DomainError(
            ErrorCode.VALIDATION_FAILED,
            400,
            `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      contentText = dto.contentText;
      const buf = Buffer.from(dto.contentText, 'utf8');
      sizeBytes = buf.length;
      checksumSha256 = sha256Hex(buf);
      tokenEstimate = estimateTokens(dto.contentText);

      if (existing.storageKey) {
        await this.storage.putBuffer(existing.storageKey, buf, existing.mimeType);
      }
    }

    let styleDescriptorText = existing.styleDescriptorText;
    let visionModel = existing.visionModel;
    let visionStatus = existing.visionStatus;
    if (dto.styleDescriptorText !== undefined) {
      styleDescriptorText = dto.styleDescriptorText;
      visionModel = 'manual';
      if (dto.styleDescriptorText && dto.styleDescriptorText.trim().length > 0) {
        visionStatus = VisionStatus.DONE;
        if (existing.kind === VaultFileKind.IMAGE) {
          tokenEstimate = estimateTokens(dto.styleDescriptorText);
        }
      }
    }

    const updated = await this.prisma.vaultFile.update({
      where: { id: fileId },
      data: {
        folderId: targetFolderId,
        name: targetName,
        extension: path.extname(targetName).replace(/^\./, '').toLowerCase(),
        contentText,
        sizeBytes,
        checksumSha256,
        tokenEstimate,
        ...(dto.scopes !== undefined ? { scopes: dto.scopes } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        styleDescriptorText,
        visionModel,
        visionStatus,
      },
      include: { folder: { select: { path: true } } },
    });

    this.events.vaultFileUpdated({
      projectId: updated.projectId,
      file: toVaultFileModel(updated),
    });

    return toVaultFileDetailModel(updated);
  }

  async delete(fileId: string): Promise<void> {
    const existing = await this.prisma.vaultFile.findUnique({ where: { id: fileId } });
    if (!existing) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Vault file not found: ${fileId}`);
    }

    await this.prisma.vaultFile.delete({ where: { id: fileId } });

    if (existing.storageKey) {
      await this.storage.delete(existing.storageKey).catch(() => undefined);
    }
    if (existing.thumbnailKey) {
      await this.storage.delete(existing.thumbnailKey).catch(() => undefined);
    }
  }

  async analyze(fileId: string, dto: AnalyzeVisionDto): Promise<VaultFileModel> {
    const existing = await this.prisma.vaultFile.findUnique({
      where: { id: fileId },
      include: { folder: { select: { path: true } } },
    });
    if (!existing) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Vault file not found: ${fileId}`);
    }
    if (existing.kind !== VaultFileKind.IMAGE) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Vision analysis is only supported for IMAGE vault files',
      );
    }

    const updated = await this.prisma.vaultFile.update({
      where: { id: fileId },
      data: {
        visionStatus: VisionStatus.PENDING,
        visionError: null,
      },
      include: { folder: { select: { path: true } } },
    });

    const model = toVaultFileModel(updated);
    this.events.vaultFileUpdated({
      projectId: updated.projectId,
      file: model,
    });

    this.visionAnalysis.enqueue(fileId, dto.middlemanProfileId);
    return model;
  }

  async contextPreview(
    projectId: string,
    query: { modality: Modality; pinned?: string; rawPrompt?: string },
  ): Promise<{
    included: ContextFileRef[];
    dropped: ContextFileRef[];
    totalTokens: number;
    budget: number;
    warnings: string[];
  }> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Project not found: ${projectId}`);
    }

    const defaultProfile = await this.prisma.middlemanProfile.findFirst({
      where: { isDefault: true },
    });
    const budget = defaultProfile?.maxContextTokens ?? DEFAULT_CONTEXT_TOKEN_BUDGET;

    const explicitPinnedIds = query.pinned
      ? query.pinned
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
      : [];

    const { candidates, warnings } = await this.vaultContext.collectCandidates(
      projectId,
      query.modality,
      explicitPinnedIds,
      query.rawPrompt ?? '',
    );

    const assembled = await this.contextAssembler.assemble(candidates, budget, {
      attachImages: false,
      maxImages: 0,
      globalSummary: project.globalSummary,
    });

    return {
      included: assembled.included,
      dropped: assembled.dropped,
      totalTokens: assembled.totalTokens,
      budget,
      warnings,
    };
  }

  private async resolveUniqueName(
    folderId: string,
    desiredName: string,
    excludeId?: string,
  ): Promise<string> {
    const ext = path.extname(desiredName);
    const stem = ext ? desiredName.slice(0, -ext.length) : desiredName;

    let candidate = desiredName;
    let index = 2;
    while (true) {
      const existing = await this.prisma.vaultFile.findUnique({
        where: { folderId_name: { folderId, name: candidate } },
      });
      if (!existing || existing.id === excludeId) {
        return candidate;
      }
      candidate = `${stem} (${index++})${ext}`;
    }
  }
}
