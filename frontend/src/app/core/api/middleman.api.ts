import { Injectable, inject } from '@angular/core';
import {
  CompilePreviewDto,
  CompilePreviewResult,
  MiddlemanProfileModel,
  MiddlemanTemplateModel,
  Modality,
  UpsertMiddlemanProfileDto,
  UpsertMiddlemanTemplateDto,
} from '@forge/shared';
import { ApiClientService } from './api-client.service';

@Injectable({ providedIn: 'root' })
export class MiddlemanApi {
  private readonly api = inject(ApiClientService);

  listProfiles(): Promise<MiddlemanProfileModel[]> {
    return this.api.get<MiddlemanProfileModel[]>('/middleman/profiles');
  }

  createProfile(dto: UpsertMiddlemanProfileDto): Promise<MiddlemanProfileModel> {
    return this.api.post<MiddlemanProfileModel>('/middleman/profiles', dto);
  }

  updateProfile(
    id: string,
    dto: Partial<UpsertMiddlemanProfileDto>,
  ): Promise<MiddlemanProfileModel> {
    return this.api.patch<MiddlemanProfileModel>(`/middleman/profiles/${id}`, dto);
  }

  deleteProfile(id: string): Promise<void> {
    return this.api.delete(`/middleman/profiles/${id}`);
  }

  listTemplates(opts?: {
    modality?: Modality;
    projectId?: string | null;
  }): Promise<MiddlemanTemplateModel[]> {
    return this.api.get<MiddlemanTemplateModel[]>('/middleman/templates', {
      modality: opts?.modality,
      projectId: opts?.projectId ?? undefined,
    });
  }

  createTemplateVersion(dto: UpsertMiddlemanTemplateDto): Promise<MiddlemanTemplateModel> {
    return this.api.post<MiddlemanTemplateModel>('/middleman/templates', dto);
  }

  activateTemplate(id: string): Promise<MiddlemanTemplateModel> {
    return this.api.patch<MiddlemanTemplateModel>(`/middleman/templates/${id}/activate`);
  }

  compilePreview(dto: CompilePreviewDto): Promise<CompilePreviewResult> {
    return this.api.post<CompilePreviewResult>('/middleman/compile-preview', dto);
  }
}
