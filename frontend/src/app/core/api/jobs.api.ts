import { Injectable, inject } from '@angular/core';
import {
  CompiledPrompt,
  CreateJobDto,
  JobEventModel,
  JobModel,
  Modality,
  Paginated,
  RecompileDto,
} from '@forge/shared';
import { ApiClientService } from './api-client.service';

@Injectable({ providedIn: 'root' })
export class JobsApi {
  private readonly api = inject(ApiClientService);

  create(dto: CreateJobDto): Promise<JobModel> {
    return this.api.post<JobModel>('/jobs', dto);
  }

  list(query: {
    projectId: string;
    modality?: Modality;
    status?: string;
    active?: boolean;
    limit?: number;
    cursor?: string;
  }): Promise<Paginated<JobModel>> {
    return this.api.get<Paginated<JobModel>>('/jobs', {
      projectId: query.projectId,
      modality: query.modality,
      status: query.status,
      active: query.active !== undefined ? (query.active ? 'true' : 'false') : undefined,
      limit: query.limit,
      cursor: query.cursor,
    });
  }

  get(id: string): Promise<JobModel> {
    return this.api.get<JobModel>(`/jobs/${id}`);
  }

  getEvents(id: string): Promise<JobEventModel[]> {
    return this.api.get<JobEventModel[]>(`/jobs/${id}/events`);
  }

  updateCompiled(id: string, compiled: CompiledPrompt): Promise<JobModel> {
    return this.api.patch<JobModel>(`/jobs/${id}/compiled`, { compiled });
  }

  recompile(id: string, dto?: RecompileDto): Promise<JobModel> {
    return this.api.post<JobModel>(`/jobs/${id}/recompile`, dto ?? {});
  }

  dispatch(id: string): Promise<JobModel> {
    return this.api.post<JobModel>(`/jobs/${id}/dispatch`);
  }

  cancel(id: string): Promise<JobModel> {
    return this.api.post<JobModel>(`/jobs/${id}/cancel`);
  }

  retry(id: string): Promise<JobModel> {
    return this.api.post<JobModel>(`/jobs/${id}/retry`);
  }

  duplicate(id: string): Promise<JobModel> {
    return this.api.post<JobModel>(`/jobs/${id}/duplicate`);
  }
}
