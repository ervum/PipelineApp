import { HttpEvent } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  AnalyzeVisionDto,
  ContextFileRef,
  ContextScope,
  CreateFolderDto,
  CreateTextFileDto,
  Modality,
  UpdateFolderDto,
  UpdateVaultFileDto,
  VaultFileDetailModel,
  VaultFileKind,
  VaultFileModel,
  VaultFolderModel,
} from '@forge/shared';
import { Observable } from 'rxjs';
import { ApiClientService } from './api-client.service';

export interface ContextPreviewResponse {
  included: ContextFileRef[];
  dropped: ContextFileRef[];
  totalTokens: number;
  budget: number;
}

@Injectable({ providedIn: 'root' })
export class VaultApi {
  private readonly api = inject(ApiClientService);

  getTree(projectId: string): Promise<VaultFolderModel> {
    return this.api.get<VaultFolderModel>(`/projects/${projectId}/vault/tree`);
  }

  createFolder(projectId: string, dto: CreateFolderDto): Promise<VaultFolderModel> {
    return this.api.post<VaultFolderModel>(`/projects/${projectId}/vault/folders`, dto);
  }

  updateFolder(folderId: string, dto: UpdateFolderDto): Promise<VaultFolderModel> {
    return this.api.patch<VaultFolderModel>(`/vault/folders/${folderId}`, dto);
  }

  deleteFolder(folderId: string, recursive = true): Promise<void> {
    return this.api.delete(`/vault/folders/${folderId}`, {
      recursive: recursive ? 'true' : 'false',
    });
  }

  listFiles(
    projectId: string,
    opts?: { folderId?: string; scope?: ContextScope; kind?: VaultFileKind },
  ): Promise<VaultFileModel[]> {
    return this.api.get<VaultFileModel[]>(`/projects/${projectId}/vault/files`, {
      folderId: opts?.folderId,
      scope: opts?.scope,
      kind: opts?.kind,
    });
  }

  searchFiles(
    projectId: string,
    opts: { q?: string; scope?: ContextScope; kind?: VaultFileKind; limit?: number },
  ): Promise<VaultFileModel[]> {
    return this.api.get<VaultFileModel[]>(`/projects/${projectId}/vault/search`, {
      q: opts.q,
      scope: opts.scope,
      kind: opts.kind,
      limit: opts.limit,
    });
  }

  createTextFile(projectId: string, dto: CreateTextFileDto): Promise<VaultFileDetailModel> {
    return this.api.post<VaultFileDetailModel>(`/projects/${projectId}/vault/files`, dto);
  }

  uploadFile(
    projectId: string,
    file: File,
    fields: { folderId: string; scopes: ContextScope[]; priority?: number; runVision?: boolean },
  ): Observable<HttpEvent<VaultFileDetailModel>> {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('folderId', fields.folderId);
    fd.append('scopes', JSON.stringify(fields.scopes));
    fd.append('priority', String(fields.priority ?? 50));
    fd.append('runVision', fields.runVision === false ? 'false' : 'true');
    return this.api.upload<VaultFileDetailModel>(`/projects/${projectId}/vault/files/upload`, fd);
  }

  getFile(fileId: string): Promise<VaultFileDetailModel> {
    return this.api.get<VaultFileDetailModel>(`/vault/files/${fileId}`);
  }

  updateFile(fileId: string, dto: UpdateVaultFileDto): Promise<VaultFileDetailModel> {
    return this.api.patch<VaultFileDetailModel>(`/vault/files/${fileId}`, dto);
  }

  deleteFile(fileId: string): Promise<void> {
    return this.api.delete(`/vault/files/${fileId}`);
  }

  analyzeVision(fileId: string, dto?: AnalyzeVisionDto): Promise<VaultFileModel> {
    return this.api.post<VaultFileModel>(`/vault/files/${fileId}/analyze`, dto ?? {});
  }

  contextPreview(
    projectId: string,
    opts: { modality: Modality; pinned?: string[]; rawPrompt?: string },
  ): Promise<ContextPreviewResponse> {
    return this.api.get<ContextPreviewResponse>(`/projects/${projectId}/vault/context-preview`, {
      modality: opts.modality,
      pinned: opts.pinned && opts.pinned.length > 0 ? opts.pinned.join(',') : undefined,
      rawPrompt: opts.rawPrompt,
    });
  }

  uploadReference(
    projectId: string,
    file: File,
  ): Promise<{ storageKey: string; url: string; width: number; height: number }> {
    const fd = new FormData();
    fd.append('file', file);
    return this.api.post<{ storageKey: string; url: string; width: number; height: number }>(
      `/media/references/${projectId}`,
      fd,
    );
  }
}
