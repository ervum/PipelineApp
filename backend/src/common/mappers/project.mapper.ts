import { ProjectModel } from '@forge/shared';
import { Project } from '@prisma/client';

export interface ProjectStatsInput {
  vaultFiles: number;
  assets: number;
  activeJobs: number;
  totalCostUsd: number;
}

export function toProjectModel(
  row: Project,
  stats: ProjectStatsInput = {
    vaultFiles: 0,
    assets: 0,
    activeJobs: 0,
    totalCostUsd: 0,
  },
): ProjectModel {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    tagline: row.tagline,
    description: row.description,
    genre: row.genre,
    accentHex: row.accentHex,
    coverUrl: row.coverStorageKey ? `/api/v1/media/projects/${row.id}/cover` : null,
    globalSummary: row.globalSummary,
    archived: row.archivedAt !== null,
    stats: {
      vaultFiles: stats.vaultFiles,
      assets: stats.assets,
      activeJobs: stats.activeJobs,
      totalCostUsd: Number(stats.totalCostUsd.toFixed(6)),
    },
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
