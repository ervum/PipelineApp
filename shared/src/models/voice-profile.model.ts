export interface VoiceProfileModel {
  id: string;
  projectId: string;
  name: string;
  characterSheetFileId: string | null;
  characterSheetName: string | null;
  providerConfigId: string | null;
  providerName: string | null;
  externalVoiceId: string;
  description: string;
  defaultSettings: Record<string, unknown>;
  sampleUrl: string | null;
}
