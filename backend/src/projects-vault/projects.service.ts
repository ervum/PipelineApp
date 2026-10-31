import {
  CreateProjectDto,
  ErrorCode,
  ProjectModel,
  TERMINAL_JOB_STATUSES,
  UpdateProjectDto,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { DomainError } from '../common/errors/domain.error';
import { ProjectStatsInput, toProjectModel } from '../common/mappers/project.mapper';
import { UploadedMulterFile } from '../common/types/multer-file.interface';
import { PrismaService } from '../prisma/prisma.service';
import { StorageKeys } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';

function toKebabSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
  return base.length >= 2 ? base : `project-${Date.now()}`;
}

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async list(includeArchived = false): Promise<ProjectModel[]> {
    const projects = await this.prisma.project.findMany({
      where: includeArchived ? {} : { archivedAt: null },
      orderBy: { createdAt: 'asc' },
    });
    if (projects.length === 0) return [];

    const statsMap = await this.loadStatsForProjects(projects.map((p) => p.id));
    return projects.map((p) => toProjectModel(p, statsMap.get(p.id)));
  }

  async get(id: string): Promise<ProjectModel> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Project not found: ${id}`);
    }
    const statsMap = await this.loadStatsForProjects([id]);
    return toProjectModel(project, statsMap.get(id));
  }

  async create(dto: CreateProjectDto): Promise<ProjectModel> {
    const baseSlug = dto.slug ?? toKebabSlug(dto.name);
    const slug = await this.resolveUniqueSlug(baseSlug);

    const created = await this.prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: {
          name: dto.name,
          slug,
          tagline: dto.tagline ?? '',
          description: dto.description ?? '',
          genre: dto.genre ?? '',
          accentHex: dto.accentHex ?? '#7C3AED',
          globalSummary: dto.globalSummary ?? '',
        },
      });

      await tx.vaultFolder.create({
        data: {
          projectId: project.id,
          parentId: null,
          name: 'Root',
          path: '/',
          sortOrder: 0,
        },
      });

      return project;
    });

    return toProjectModel(created);
  }

  async update(id: string, dto: UpdateProjectDto): Promise<ProjectModel> {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Project not found: ${id}`);
    }

    let slug = existing.slug;
    if (dto.slug && dto.slug !== existing.slug) {
      slug = await this.resolveUniqueSlug(dto.slug, id);
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        slug,
        ...(dto.tagline !== undefined ? { tagline: dto.tagline } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.genre !== undefined ? { genre: dto.genre } : {}),
        ...(dto.accentHex !== undefined ? { accentHex: dto.accentHex } : {}),
        ...(dto.globalSummary !== undefined ? { globalSummary: dto.globalSummary } : {}),
        ...(dto.archived !== undefined
          ? { archivedAt: dto.archived ? (existing.archivedAt ?? new Date()) : null }
          : {}),
      },
    });

    const statsMap = await this.loadStatsForProjects([id]);
    return toProjectModel(updated, statsMap.get(id));
  }

  async delete(id: string): Promise<void> {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Project not found: ${id}`);
    }

    await this.prisma.project.delete({ where: { id } });
    await this.storage.deletePrefix(`projects/${id}`);
  }

  async uploadCover(id: string, file?: UploadedMulterFile): Promise<ProjectModel> {
    const existing = await this.prisma.project.findUnique({ where: { id } });
    if (!existing) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Project not found: ${id}`);
    }
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 400, 'Cover image file is required');
    }
    if (!file.mimetype.startsWith('image/')) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 400, 'Cover file must be an image');
    }

    const coverWebp = await sharp(file.buffer)
      .resize(1200, 630, { fit: 'cover' })
      .webp({ quality: 84 })
      .toBuffer();

    const coverKey = StorageKeys.projectCover(id);
    await this.storage.putBuffer(coverKey, coverWebp, 'image/webp');

    const updated = await this.prisma.project.update({
      where: { id },
      data: { coverStorageKey: coverKey },
    });

    const statsMap = await this.loadStatsForProjects([id]);
    return toProjectModel(updated, statsMap.get(id));
  }

  private async resolveUniqueSlug(baseSlug: string, excludeId?: string): Promise<string> {
    let candidate = baseSlug;
    let suffix = 2;
    while (true) {
      const conflict = await this.prisma.project.findUnique({ where: { slug: candidate } });
      if (!conflict || conflict.id === excludeId) {
        return candidate;
      }
      candidate = `${baseSlug}-${suffix++}`;
    }
  }

  private async loadStatsForProjects(
    projectIds: string[],
  ): Promise<Map<string, ProjectStatsInput>> {
    const [vaultCounts, assetCounts, activeJobCounts, jobCosts] = await Promise.all([
      this.prisma.vaultFile.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      }),
      this.prisma.generatedAsset.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds } },
        _count: { _all: true },
      }),
      this.prisma.generationJob.groupBy({
        by: ['projectId'],
        where: {
          projectId: { in: projectIds },
          status: { notIn: Array.from(TERMINAL_JOB_STATUSES) },
        },
        _count: { _all: true },
      }),
      this.prisma.generationJob.groupBy({
        by: ['projectId'],
        where: { projectId: { in: projectIds } },
        _sum: { costUsd: true },
      }),
    ]);

    const map = new Map<string, ProjectStatsInput>();
    for (const pid of projectIds) {
      map.set(pid, { vaultFiles: 0, assets: 0, activeJobs: 0, totalCostUsd: 0 });
    }
    for (const row of vaultCounts) {
      const entry = map.get(row.projectId);
      if (entry) entry.vaultFiles = row._count._all;
    }
    for (const row of assetCounts) {
      const entry = map.get(row.projectId);
      if (entry) entry.assets = row._count._all;
    }
    for (const row of activeJobCounts) {
      const entry = map.get(row.projectId);
      if (entry) entry.activeJobs = row._count._all;
    }
    for (const row of jobCosts) {
      const entry = map.get(row.projectId);
      if (entry && row._sum.costUsd !== null) {
        entry.totalCostUsd = Number(row._sum.costUsd);
      }
    }
    return map;
  }
}
