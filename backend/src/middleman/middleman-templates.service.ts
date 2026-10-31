import {
  ErrorCode,
  MiddlemanTemplateModel,
  Modality,
  UpsertMiddlemanTemplateDto,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { MiddlemanTemplate, Prisma } from '@prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toMiddlemanTemplateModel } from '../common/mappers/middleman.mapper';
import { PrismaService } from '../prisma/prisma.service';

const BUILTIN_GLOBAL_TEMPLATES: Partial<
  Record<
    Modality,
    {
      name: string;
      systemTemplate: string;
      defaultNegativePrompt: string;
      hardConstraints: string;
    }
  >
> = {
  VIDEO: {
    name: 'Global Video & Motion Director v1',
    systemTemplate: [
      'Direct cinematic game video clips, VFX loops, character turntables, and environment pans.',
      'Specify camera trajectory, subject motion, temporal lighting continuity, atmospheric particles, and framing across the full clip duration.',
      'Align color palette, architectural motifs, and VFX energy colors strictly with the Project Vault.',
    ].join('\n'),
    defaultNegativePrompt:
      'flickering lighting, temporal morphing, distorted limbs, watermark, text overlay, frame jump, blurry motion smear',
    hardConstraints: [
      '- Maintain consistent subject proportions and palette from first frame to final frame.',
      '- Clearly state camera movement direction and speed.',
    ].join('\n'),
  },
  LORE: {
    name: 'Global Lore & Narrative Chronicler v1',
    systemTemplate: [
      'Author canonical in-world game lore, ranging from concise Short-Form item descriptions and skill tooltips to Long-Form character backstories, faction chronicles, and world mythology.',
      'Weave faction names, historical eras, materials, and thematic motifs from the Project Vault seamlessly into the narrative.',
      'Match the requested lengthForm, loreCategory, tone, and perspective with literary precision.',
    ].join('\n'),
    defaultNegativePrompt:
      'modern slang, fourth-wall breaks, meta-commentary, placeholder names, out-of-universe references',
    hardConstraints: [
      '- Never contradict established Project Vault canon, faction alignments, or character histories.',
      '- Honor the requested targetWordCount and lengthForm (SHORT_FORM vs MEDIUM_FORM vs LONG_FORM).',
    ].join('\n'),
  },
};

@Injectable()
export class MiddlemanTemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  private async ensureBuiltinTemplates(): Promise<void> {
    for (const [mod, tpl] of Object.entries(BUILTIN_GLOBAL_TEMPLATES) as Array<
      [Modality, NonNullable<(typeof BUILTIN_GLOBAL_TEMPLATES)[Modality]>]
    >) {
      const existing = await this.prisma.middlemanTemplate.findFirst({
        where: { projectId: null, modality: mod },
      });
      if (!existing) {
        await this.prisma.middlemanTemplate.create({
          data: {
            projectId: null,
            modality: mod,
            name: tpl.name,
            systemTemplate: tpl.systemTemplate,
            defaultNegativePrompt: tpl.defaultNegativePrompt,
            hardConstraints: tpl.hardConstraints,
            version: 1,
            isActive: true,
          },
        });
      }
    }
  }

  async list(query: {
    modality?: Modality;
    projectId?: string;
  }): Promise<MiddlemanTemplateModel[]> {
    await this.ensureBuiltinTemplates();
    const where: Prisma.MiddlemanTemplateWhereInput = {};
    if (query.modality) {
      where.modality = query.modality;
    }
    if (query.projectId !== undefined) {
      if (query.projectId === '' || query.projectId === 'null') {
        where.projectId = null;
      } else {
        where.OR = [{ projectId: query.projectId }, { projectId: null }];
      }
    }

    const rows = await this.prisma.middlemanTemplate.findMany({
      where,
      orderBy: [{ modality: 'asc' }, { version: 'desc' }],
    });

    return rows.map(toMiddlemanTemplateModel);
  }

  /**
   * Resolves the active MiddlemanTemplate for (projectId, modality):
   * 1. Active project override (`projectId = projectId, modality, isActive = true`)
   * 2. Active global template (`projectId = null, modality, isActive = true`)
   * 3. Latest global template fallback
   */
  async resolve(projectId: string, modality: Modality): Promise<MiddlemanTemplate> {
    await this.ensureBuiltinTemplates();
    const projectOverride = await this.prisma.middlemanTemplate.findFirst({
      where: {
        projectId,
        modality,
        isActive: true,
      },
      orderBy: { version: 'desc' },
    });
    if (projectOverride) {
      return projectOverride;
    }

    const globalActive = await this.prisma.middlemanTemplate.findFirst({
      where: {
        projectId: null,
        modality,
        isActive: true,
      },
      orderBy: { version: 'desc' },
    });
    if (globalActive) {
      return globalActive;
    }

    const anyFallback = await this.prisma.middlemanTemplate.findFirst({
      where: {
        projectId: null,
        modality,
      },
      orderBy: { version: 'desc' },
    });
    if (anyFallback) {
      return anyFallback;
    }

    throw new DomainError(
      ErrorCode.NOT_FOUND,
      404,
      `No Middleman template found for modality "${modality}"`,
    );
  }

  async createVersion(dto: UpsertMiddlemanTemplateDto): Promise<MiddlemanTemplateModel> {
    if (dto.projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: dto.projectId },
      });
      if (!project) {
        throw new DomainError(
          ErrorCode.NOT_FOUND,
          404,
          `Project "${dto.projectId}" not found`,
        );
      }
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const agg = await tx.middlemanTemplate.aggregate({
        where: {
          projectId: dto.projectId ?? null,
          modality: dto.modality,
        },
        _max: {
          version: true,
        },
      });
      const nextVersion = (agg._max.version ?? 0) + 1;

      await tx.middlemanTemplate.updateMany({
        where: {
          projectId: dto.projectId ?? null,
          modality: dto.modality,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      return tx.middlemanTemplate.create({
        data: {
          projectId: dto.projectId ?? null,
          modality: dto.modality,
          name: dto.name,
          systemTemplate: dto.systemTemplate,
          defaultNegativePrompt: dto.defaultNegativePrompt,
          hardConstraints: dto.hardConstraints,
          version: nextVersion,
          isActive: true,
        },
      });
    });

    return toMiddlemanTemplateModel(created);
  }

  async activate(id: string): Promise<MiddlemanTemplateModel> {
    const existing = await this.prisma.middlemanTemplate.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Middleman template "${id}" not found`,
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.middlemanTemplate.updateMany({
        where: {
          projectId: existing.projectId,
          modality: existing.modality,
          id: { not: existing.id },
        },
        data: {
          isActive: false,
        },
      });

      return tx.middlemanTemplate.update({
        where: { id: existing.id },
        data: { isActive: true },
      });
    });

    return toMiddlemanTemplateModel(updated);
  }
}
