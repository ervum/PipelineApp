import { Modality } from '../enums';

export type McpToolCategory = 'GENERATION' | 'MIDDLEMAN' | 'VAULT' | 'ASSETS_JOBS';

export interface McpToolParameterProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: Array<string | number>;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  items?: {
    type: string;
    enum?: string[];
  };
}

export interface McpToolInputSchema {
  type: 'object';
  properties: Record<string, McpToolParameterProperty>;
  required?: string[];
}

export interface McpToolDefinition {
  name: string;
  title: string;
  category: McpToolCategory;
  modality: Modality | null;
  description: string;
  inputSchema: McpToolInputSchema;
  sampleArgs: Record<string, unknown>;
}

export type McpContentBlock =
  | {
      type: 'text';
      text: string;
    }
  | {
      type: 'image';
      data: string;
      mimeType: string;
    }
  | {
      type: 'resource';
      resource: {
        uri: string;
        mimeType: string;
        text?: string;
        blob?: string;
      };
    };

export interface McpToolCallResult {
  content: McpContentBlock[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

export interface McpResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export interface McpPromptDefinition {
  name: string;
  description: string;
  arguments: Array<{
    name: string;
    description: string;
    required: boolean;
  }>;
}

export interface McpInvocationLogEntry {
  id: string;
  timestamp: string;
  toolName: string;
  transport: 'HTTP_RPC' | 'STDIO' | 'PLAYGROUND';
  durationMs: number;
  isError: boolean;
  argsSummary: string;
  assetIds: string[];
  primaryAssetUrl: string | null;
  primaryModality: Modality | null;
  errorMessage: string | null;
}

export interface McpHardwareProfile {
  systemRamGb: number;
  ramType: string;
  vramFallbackEnabled: boolean;
  recommendedMemoryStrategy: 'AUTO' | 'RAM_FALLBACK_32GB' | 'LOW_VRAM_TILED' | 'VRAM_ONLY';
  notes: string;
}

export interface McpServerStatusModel {
  serverName: string;
  serverVersion: string;
  protocolVersion: string;
  httpEndpoint: string;
  sseEndpoint: string;
  stdioCommand: string;
  stdioArgs: string[];
  toolCount: number;
  resourceCount: number;
  promptCount: number;
  totalInvocations: number;
  hardwareProfile: McpHardwareProfile;
  recentLogs: McpInvocationLogEntry[];
}
