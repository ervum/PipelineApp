import { Injectable, inject } from '@angular/core';
import { UpsertVoiceProfileDto, VoiceProfileModel } from '@forge/shared';
import { ApiClientService } from './api-client.service';

@Injectable({ providedIn: 'root' })
export class VoiceProfilesApi {
  private readonly api = inject(ApiClientService);

  list(projectId: string): Promise<VoiceProfileModel[]> {
    return this.api.get<VoiceProfileModel[]>(`/projects/${projectId}/voice-profiles`);
  }

  create(projectId: string, dto: UpsertVoiceProfileDto): Promise<VoiceProfileModel> {
    return this.api.post<VoiceProfileModel>(`/projects/${projectId}/voice-profiles`, dto);
  }

  update(voiceId: string, dto: Partial<UpsertVoiceProfileDto>): Promise<VoiceProfileModel> {
    return this.api.patch<VoiceProfileModel>(`/voice-profiles/${voiceId}`, dto);
  }

  delete(voiceId: string): Promise<void> {
    return this.api.delete(`/voice-profiles/${voiceId}`);
  }
}
