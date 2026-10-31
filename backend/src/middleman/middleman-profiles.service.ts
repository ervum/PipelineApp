import {
  ErrorCode,
  MiddlemanProfileModel,
  ProviderRole,
  UpsertMiddlemanProfileDto,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error';
import { toMiddlemanProfileModel } from '../common/mappers/middleman.mapper';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class MiddlemanProfilesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<MiddlemanProfileModel[]> {
    const rows = await this.prisma.middlemanProfile.findMany({
      include: {
        providerConfig: {
          select: { id: true, name: true, kind: true, tier: true },
        },
      },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map(toMiddlemanProfileModel);
  }

  async getById(id: string): Promise<MiddlemanProfileModel> {
    const row = await this.prisma.middlemanProfile.findUnique({
      where: { id },
      include: {
        providerConfig: {
          select: { id: true, name: true, kind: true, tier: true },
        },
      },
    });
    if (!row) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Middleman profile "${id}" not found`,
      );
    }
    return toMiddlemanProfileModel(row);
  }

  async create(dto: UpsertMiddlemanProfileDto): Promise<MiddlemanProfileModel> {
    const provider = await this.prisma.aiProviderConfig.findUnique({
      where: { id: dto.providerConfigId },
    });
    if (!provider) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Provider config "${dto.providerConfigId}" not found`,
      );
    }
    if (!provider.roles.includes(ProviderRole.LLM)) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        `Provider "${provider.name}" does not support the LLM role`,
      );
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) {
        await tx.middlemanProfile.updateMany({
          where: { isDefault: true },
          data: { isDefault: false },
        });
      }
      if (dto.isVisionDefault) {
        await tx.middlemanProfile.updateMany({
          where: { isVisionDefault: true },
          data: { isVisionDefault: false },
        });
      }
      return tx.middlemanProfile.create({
        data: {
          name: dto.name,
          providerConfigId: dto.providerConfigId,
          model: dto.model,
          temperature: dto.temperature,
          maxOutputTokens: dto.maxOutputTokens,
          maxContextTokens: dto.maxContextTokens,
          supportsVision: dto.supportsVision,
          attachReferenceImages: dto.attachReferenceImages,
          maxReferenceImages: dto.maxReferenceImages,
          jsonMode: dto.jsonMode,
          isDefault: dto.isDefault,
          isVisionDefault: dto.isVisionDefault,
        },
        include: {
          providerConfig: {
            select: { id: true, name: true, kind: true, tier: true },
          },
        },
      });
    });

    return toMiddlemanProfileModel(row);
  }

  async update(
    id: string,
    dto: Partial<UpsertMiddlemanProfileDto>,
  ): Promise<MiddlemanProfileModel> {
    const existing = await this.prisma.middlemanProfile.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Middleman profile "${id}" not found`,
      );
    }

    if (dto.providerConfigId) {
      const provider = await this.prisma.aiProviderConfig.findUnique({
        where: { id: dto.providerConfigId },
      });
      if (!provider) {
        throw new DomainError(
          ErrorCode.NOT_FOUND,
          404,
          `Provider config "${dto.providerConfigId}" not found`,
        );
      }
      if (!provider.roles.includes(ProviderRole.LLM)) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          400,
          `Provider "${provider.name}" does not support the LLM role`,
        );
      }
    }

    const row = await this.prisma.$transaction(async (tx) => {
      if (dto.isDefault === true) {
        await tx.middlemanProfile.updateMany({
          where: { isDefault: true, id: { not: id } },
          data: { isDefault: false },
        });
      }
      if (dto.isVisionDefault === true) {
        await tx.middlemanProfile.updateMany({
          where: { isVisionDefault: true, id: { not: id } },
          data: { isVisionDefault: false },
        });
      }
      return tx.middlemanProfile.update({
        where: { id },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.providerConfigId !== undefined
            ? { providerConfigId: dto.providerConfigId }
            : {}),
          ...(dto.model !== undefined ? { model: dto.model } : {}),
          ...(dto.temperature !== undefined
            ? { temperature: dto.temperature }
            : {}),
          ...(dto.maxOutputTokens !== undefined
            ? { maxOutputTokens: dto.maxOutputTokens }
            : {}),
          ...(dto.maxContextTokens !== undefined
            ? { maxContextTokens: dto.maxContextTokens }
            : {}),
          ...(dto.supportsVision !== undefined
            ? { supportsVision: dto.supportsVision }
            : {}),
          ...(dto.attachReferenceImages !== undefined
            ? { attachReferenceImages: dto.attachReferenceImages }
            : {}),
          ...(dto.maxReferenceImages !== undefined
            ? { maxReferenceImages: dto.maxReferenceImages }
            : {}),
          ...(dto.jsonMode !== undefined ? { jsonMode: dto.jsonMode } : {}),
          ...(dto.isDefault !== undefined ? { isDefault: dto.isDefault } : {}),
          ...(dto.isVisionDefault !== undefined
            ? { isVisionDefault: dto.isVisionDefault }
            : {}),
        },
        include: {
          providerConfig: {
            select: { id: true, name: true, kind: true, tier: true },
          },
        },
      });
    });

    return toMiddlemanProfileModel(row);
  }

  async delete(id: string): Promise<void> {
    const existing = await this.prisma.middlemanProfile.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Middleman profile "${id}" not found`,
      );
    }

    await this.prisma.middlemanProfile.delete({
      where: { id },
    });
  }
}
