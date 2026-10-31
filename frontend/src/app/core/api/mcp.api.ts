import { Injectable, inject } from '@angular/core';
import {
  McpInvocationLogEntry,
  McpInvokeToolDto,
  McpServerStatusModel,
  McpToolCallResult,
  McpToolDefinition,
} from '@forge/shared';
import { ApiClientService } from './api-client.service';

@Injectable({ providedIn: 'root' })
export class McpApi {
  private readonly api = inject(ApiClientService);

  getStatus(): Promise<McpServerStatusModel> {
    return this.api.get<McpServerStatusModel>('/mcp/status');
  }

  listTools(): Promise<McpToolDefinition[]> {
    return this.api.get<McpToolDefinition[]>('/mcp/tools');
  }

  listLogs(): Promise<McpInvocationLogEntry[]> {
    return this.api.get<McpInvocationLogEntry[]>('/mcp/logs');
  }

  invokeTool(dto: McpInvokeToolDto): Promise<McpToolCallResult> {
    return this.api.post<McpToolCallResult>('/mcp/invoke', dto);
  }
}
