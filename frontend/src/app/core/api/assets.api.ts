import { HttpEventType } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  ApprovalStatus,
  AssetModel,
  ExecutionMode,
  ExecutionTier,
  JobModel,
  Modality,
  Paginated,
  SaveAssetToVaultDto,
  UpdateAssetDto,
  VaultFileModel,
} from '@forge/shared';
import { filter, firstValueFrom, map } from 'rxjs';
import { ApiClientService } from './api-client.service';

export interface AssetWithLineage extends AssetModel {
  lineage?: AssetModel[];
}

export interface UploadedReference {
  storageKey: string;
  url: string;
  width: number;
  height: number;
}

@Injectable({ providedIn: 'root' })
export class AssetsApi {
  private readonly api = inject(ApiClientService);

  list(query: {
    projectId: string;
    modality?: Modality;
    approval?: ApprovalStatus;
    favorite?: boolean;
    tier?: ExecutionTier;
    q?: string;
    sort?: 'newest' | 'oldest' | 'cost' | 'duration';
    limit?: number;
    cursor?: string;
  }): Promise<Paginated<AssetModel>> {
    return this.api.get<Paginated<AssetModel>>('/assets', {
      projectId: query.projectId,
      modality: query.modality,
      approval: query.approval,
      favorite: query.favorite !== undefined ? (query.favorite ? 'true' : 'false') : undefined,
      tier: query.tier,
      q: query.q,
      sort: query.sort,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  get(id: string): Promise<AssetWithLineage> {
    return this.api.get<AssetWithLineage>(`/assets/${id}`);
  }

  update(id: string, dto: UpdateAssetDto): Promise<AssetModel> {
    return this.api.patch<AssetModel>(`/assets/${id}`, dto);
  }

  delete(id: string): Promise<void> {
    return this.api.delete(`/assets/${id}`);
  }

  saveToVault(id: string, dto: SaveAssetToVaultDto): Promise<VaultFileModel> {
    return this.api.post<VaultFileModel>(`/assets/${id}/save-to-vault`, dto);
  }

  variation(id: string, executionMode: ExecutionMode): Promise<JobModel> {
    return this.api.post<JobModel>(`/assets/${id}/variation`, { executionMode });
  }

  uploadReference(projectId: string, file: File): Promise<UploadedReference> {
    const fd = new FormData();
    fd.append('file', file);
    return firstValueFrom(
      this.api.upload<UploadedReference>(`/media/references/${projectId}`, fd).pipe(
        filter((e) => e.type === HttpEventType.Response),
        map((e) => e.body as UploadedReference),
      ),
    );
  }
}
