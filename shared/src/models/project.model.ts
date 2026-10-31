export interface ProjectModel {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  genre: string;
  accentHex: string;
  coverUrl: string | null;
  globalSummary: string;
  archived: boolean;
  stats: {
    vaultFiles: number;
    assets: number;
    activeJobs: number;
    totalCostUsd: number;
  };
  createdAt: string;
  updatedAt: string;
}
