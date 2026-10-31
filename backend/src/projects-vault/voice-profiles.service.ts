import {
  ErrorCode,
  UpsertVoiceProfileDto,
  VaultFileKind,
  VoiceProfileModel,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toVoiceProfileModel } from '../common/mappers/vault.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { StorageKeys } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import { synthesizeVoice } from '../synth/wav-audio.synth';

@Injectable()
export class VoiceProfilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(projectId: string): Promise<VoiceProfileModel[]> {
    const rows = await this.prisma.voiceProfile.findMany({
      where: { projectId },
      include: {
        characterSheet: { select: { id: true, name: true } },
        providerConfig: { select: { id: true, name: true } },
      },
      orderBy: { name: 'asc' },
    });
    return rows.map(toVoiceProfileModel);
  }

  async create(projectId: string, dto: UpsertVoiceProfileDto): Promise<VoiceProfileModel> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Project not found: ${projectId}`);
    }

    if (dto.characterSheetFileId) {
      await this.validateCharacterSheet(projectId, dto.characterSheetFileId);
    }

    const created = await this.prisma.voiceProfile.create({
      data: {
        projectId,
        name: dto.name,
        characterSheetFileId: dto.characterSheetFileId ?? null,
        providerConfigId: dto.providerConfigId ?? null,
        externalVoiceId: dto.externalVoiceId ?? '',
        description: dto.description ?? '',
        defaultSettings: (dto.defaultSettings ?? {}) as Prisma.InputJsonValue,
      },
    });

    const sampleRes = synthesizeVoice({
      seed: 20261022,
      transcript: `Voice sample for ${dto.name}.`,
      voiceId: dto.externalVoiceId || 'demo-alto-warm',
      speed: dto.defaultSettings?.speed ?? 1.0,
    });
    const sampleKey = StorageKeys.voiceSample(projectId, created.id, 'sample.wav');
    await this.storage.putBuffer(sampleKey, sampleRes.wav, 'audio/wav');

    const finalized = await this.prisma.voiceProfile.update({
      where: { id: created.id },
      data: { sampleStorageKey: sampleKey },
      include: {
        characterSheet: { select: { id: true, name: true } },
        providerConfig: { select: { id: true, name: true } },
      },
    });

    return toVoiceProfileModel(finalized);
  }

  async update(
    voiceId: string,
    dto: Partial<UpsertVoiceProfileDto>,
  ): Promise<VoiceProfileModel> {
    const existing = await this.prisma.voiceProfile.findUnique({ where: { id: voiceId } });
    if (!existing) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Voice profile not found: ${voiceId}`);
    }

    if (dto.characterSheetFileId) {
      await this.validateCharacterSheet(existing.projectId, dto.characterSheetFileId);
    }

    const updated = await this.prisma.voiceProfile.update({
      where: { id: voiceId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.characterSheetFileId !== undefined
          ? { characterSheetFileId: dto.characterSheetFileId }
          : {}),
        ...(dto.providerConfigId !== undefined
          ? { providerConfigId: dto.providerConfigId }
          : {}),
        ...(dto.externalVoiceId !== undefined
          ? { externalVoiceId: dto.externalVoiceId }
          : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.defaultSettings !== undefined
          ? { defaultSettings: dto.defaultSettings as Prisma.InputJsonValue }
          : {}),
      },
      include: {
        characterSheet: { select: { id: true, name: true } },
        providerConfig: { select: { id: true, name: true } },
      },
    });

    return toVoiceProfileModel(updated);
  }

  async delete(voiceId: string): Promise<void> {
    const existing = await this.prisma.voiceProfile.findUnique({ where: { id: voiceId } });
    if (!existing) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Voice profile not found: ${voiceId}`);
    }

    await this.prisma.voiceProfile.delete({ where: { id: voiceId } });
    if (existing.sampleStorageKey) {
      await this.storage.delete(existing.sampleStorageKey).catch(() => undefined);
    }
  }

  private async validateCharacterSheet(projectId: string, fileId: string): Promise<void> {
    const file = await this.prisma.vaultFile.findUnique({ where: { id: fileId } });
    if (!file || file.projectId !== projectId) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        `Character sheet file ${fileId} does not belong to project ${projectId}`,
      );
    }
    if (file.kind !== VaultFileKind.MARKDOWN && file.kind !== VaultFileKind.TEXT) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        `Character sheet file must be MARKDOWN or TEXT (got ${file.kind})`,
      );
    }
  }
}
