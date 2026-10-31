import { Injectable, inject } from '@angular/core';
import { CreateProjectDto, ProjectModel, UpdateProjectDto } from '@forge/shared';
import { filter, firstValueFrom, map } from 'rxjs';
import { HttpEventType } from '@angular/common/http';
import { ApiClientService } from './api-client.service';

@Injectable({ providedIn: 'root' })
export class ProjectsApi {
  private readonly api = inject(ApiClientService);

  list(includeArchived = false): Promise<ProjectModel[]> {
    return this.api.get<ProjectModel[]>('/projects', {
      includeArchived: includeArchived ? 'true' : undefined,
    });
  }

  get(id: string): Promise<ProjectModel> {
    return this.api.get<ProjectModel>(`/projects/${id}`);
  }

  create(dto: CreateProjectDto): Promise<ProjectModel> {
    return this.api.post<ProjectModel>('/projects', dto);
  }

  update(id: string, dto: UpdateProjectDto): Promise<ProjectModel> {
    return this.api.patch<ProjectModel>(`/projects/${id}`, dto);
  }

  delete(id: string): Promise<void> {
    return this.api.delete(`/projects/${id}`);
  }

  uploadCover(id: string, file: File): Promise<ProjectModel> {
    const fd = new FormData();
    fd.append('file', file);
    return firstValueFrom(
      this.api.upload<ProjectModel>(`/projects/${id}/cover`, fd).pipe(
        filter((e) => e.type === HttpEventType.Response),
        map((e) => e.body as ProjectModel),
      ),
    );
  }
}
