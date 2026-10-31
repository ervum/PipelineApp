import { Injectable, inject } from '@angular/core';
import {
  AdapterDescriptor,
  InterpolationResult,
  ProviderCatalogEntry,
  ProviderConfigModel,
  TemplatePreviewDto,
  UpsertProviderDto,
} from '@forge/shared';
import { ApiClientService } from './api-client.service';

export interface SystemHealthResponse {
  status: 'ok' | 'degraded';
  db: boolean;
  storage: boolean;
  version: string;
  webhooksEnabled?: boolean;
}

export interface GoogleWebStatusResponse {
  geminiAuthenticated: boolean;
  aiStudioAuthenticated: boolean;
  browserRunning: boolean;
  browserVisible: boolean;
  activeJobs: string[];
  trackedChatsCount: number;
}

export interface TrackedWebChatItem {
  id: string;
  providerConfigId: string | null;
  projectId: string | null;
  jobId: string | null;
  role: 'MIDDLEMAN' | 'GENERATOR';
  modality: string | null;
  platform: 'gemini' | 'aistudio';
  modelId: string;
  chatUrl: string;
  externalChatId: string | null;
  chatTitle: string | null;
  createdAt: string;
  deletedFromWebAt: string | null;
}

@Injectable({ providedIn: 'root' })
export class ProvidersApi {
  private readonly api = inject(ApiClientService);

  list(): Promise<ProviderConfigModel[]> {
    return this.api.get<ProviderConfigModel[]>('/providers');
  }

  getCatalog(): Promise<ProviderCatalogEntry[]> {
    return this.api.get<ProviderCatalogEntry[]>('/providers/catalog');
  }

  create(dto: UpsertProviderDto): Promise<ProviderConfigModel> {
    return this.api.post<ProviderConfigModel>('/providers', dto);
  }

  update(id: string, dto: Partial<UpsertProviderDto>): Promise<ProviderConfigModel> {
    return this.api.patch<ProviderConfigModel>(`/providers/${id}`, dto);
  }

  delete(id: string): Promise<void> {
    return this.api.delete(`/providers/${id}`);
  }

  checkHealth(id: string): Promise<ProviderConfigModel> {
    return this.api.post<ProviderConfigModel>(`/providers/${id}/health`);
  }

  getAdapters(id: string): Promise<AdapterDescriptor[]> {
    return this.api.get<AdapterDescriptor[]>(`/providers/${id}/adapters`);
  }

  previewTemplate(dto: TemplatePreviewDto): Promise<InterpolationResult> {
    return this.api.post<InterpolationResult>('/providers/template-preview', dto);
  }

  systemHealth(): Promise<SystemHealthResponse> {
    return this.api.get<SystemHealthResponse>('/health');
  }

  getGoogleWebStatus(): Promise<GoogleWebStatusResponse> {
    return this.api.get<GoogleWebStatusResponse>('/providers/google-web/status');
  }

  loginGoogleWeb(
    target: 'gemini' | 'aistudio' = 'aistudio',
  ): Promise<{ url: string; visible: boolean }> {
    return this.api.post<{ url: string; visible: boolean }>(
      '/providers/google-web/login',
      { target },
    );
  }

  setBrowserVisibility(visible: boolean): Promise<{ visible: boolean }> {
    return this.api.post<{ visible: boolean }>(
      '/providers/google-web/browser-visibility',
      { visible },
    );
  }

  triggerAnswerNow(
    jobId?: string,
  ): Promise<{ clicked: boolean; message: string }> {
    return this.api.post<{ clicked: boolean; message: string }>(
      '/providers/google-web/answer-now',
      { jobId },
    );
  }

  listTrackedWebChats(): Promise<TrackedWebChatItem[]> {
    return this.api.get<TrackedWebChatItem[]>('/providers/google-web/chats');
  }

  deleteLastRunWebChats(): Promise<{ deletedCount: number }> {
    return this.api.delete<{ deletedCount: number }>(
      '/providers/google-web/chats/last-run',
    );
  }

  deleteAllTrackedWebChats(): Promise<{ deletedCount: number }> {
    return this.api.delete<{ deletedCount: number }>(
      '/providers/google-web/chats/all',
    );
  }

  deleteWebChatsForJob(jobId: string): Promise<{ deletedCount: number }> {
    return this.api.delete<{ deletedCount: number }>(
      `/providers/google-web/chats/job/${jobId}`,
    );
  }

  deleteWebChatById(chatId: string): Promise<{ deleted: boolean }> {
    return this.api.delete<{ deleted: boolean }>(
      `/providers/google-web/chats/${chatId}`,
    );
  }
}
