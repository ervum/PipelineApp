import {
  McpInvokeToolDto,
  McpInvokeToolSchema,
  McpInvocationLogEntry,
  McpServerStatusModel,
  McpToolCallResult,
  McpToolDefinition,
} from '@forge/shared';
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { McpToolsService } from './mcp-tools.service';

export interface JsonRpcRequest {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

@Controller('mcp')
export class McpController {
  constructor(private readonly mcpTools: McpToolsService) {}

  @Get('status')
  async getStatus(@Req() req: Request): Promise<McpServerStatusModel> {
    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3333';
    return this.mcpTools.getStatus(`${protocol}://${host}`);
  }

  @Get('tools')
  listTools(): McpToolDefinition[] {
    return this.mcpTools.getTools();
  }

  @Get('logs')
  listLogs(): McpInvocationLogEntry[] {
    return this.mcpTools.getLogs();
  }

  @Post('invoke')
  @HttpCode(200)
  async invokeFromPlayground(
    @ZodBody(McpInvokeToolSchema) dto: McpInvokeToolDto,
  ): Promise<McpToolCallResult> {
    return this.mcpTools.callTool(dto.name, dto.arguments, 'PLAYGROUND');
  }

  /**
   * Standard MCP Streamable HTTP / JSON-RPC 2.0 endpoint (`POST /api/v1/mcp`).
   * Supports initialize, notifications/initialized, ping, tools/list, tools/call,
   * resources/list, resources/read, prompts/list, prompts/get.
   */
  @Post()
  @HttpCode(200)
  async handleJsonRpc(
    @Body() body: JsonRpcRequest | JsonRpcRequest[],
  ): Promise<JsonRpcResponse | JsonRpcResponse[]> {
    if (Array.isArray(body)) {
      const results: JsonRpcResponse[] = [];
      for (const item of body) {
        const res = await this.processSingleRpc(item, 'HTTP_RPC');
        if (res) results.push(res);
      }
      return results;
    }
    const single = await this.processSingleRpc(body, 'HTTP_RPC');
    return (
      single ?? {
        jsonrpc: '2.0',
        id: null,
        result: {},
      }
    );
  }

  /**
   * SSE discovery & keepalive stream (`GET /api/v1/mcp/sse`) for SSE-based MCP clients.
   */
  @Get('sse')
  handleSse(@Req() req: Request, @Res() res: Response): void {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    const protocol = req.protocol || 'http';
    const host = req.get('host') || 'localhost:3333';
    const postEndpoint = `${protocol}://${host}/api/v1/mcp`;
    res.write(`event: endpoint\ndata: ${postEndpoint}\n\n`);

    const timer = setInterval(() => {
      res.write(`: keepalive ${Date.now()}\n\n`);
    }, 15_000);

    req.on('close', () => {
      clearInterval(timer);
    });
  }

  async processSingleRpc(
    rpc: JsonRpcRequest,
    transport: 'HTTP_RPC' | 'STDIO',
  ): Promise<JsonRpcResponse | null> {
    const id = rpc.id !== undefined ? rpc.id : null;
    const method = rpc.method ?? '';
    const params = rpc.params ?? {};

    // Notifications have no id and expect no response
    if (method.startsWith('notifications/')) {
      return null;
    }

    try {
      switch (method) {
        case 'initialize':
          return {
            jsonrpc: '2.0',
            id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: {
                tools: { listChanged: false },
                resources: { subscribe: false, listChanged: false },
                prompts: { listChanged: false },
              },
              serverInfo: {
                name: 'forgestudio-control-room-mcp',
                version: '1.0.0',
              },
            },
          };

        case 'ping':
          return {
            jsonrpc: '2.0',
            id,
            result: {},
          };

        case 'tools/list': {
          const tools = this.mcpTools.getTools().map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          }));
          return {
            jsonrpc: '2.0',
            id,
            result: { tools },
          };
        }

        case 'tools/call': {
          const name = typeof params['name'] === 'string' ? params['name'] : '';
          const args =
            typeof params['arguments'] === 'object' &&
            params['arguments'] !== null
              ? (params['arguments'] as Record<string, unknown>)
              : {};
          const callResult = await this.mcpTools.callTool(name, args, transport);
          return {
            jsonrpc: '2.0',
            id,
            result: callResult,
          };
        }

        case 'resources/list': {
          const resources = await this.mcpTools.listResources();
          return {
            jsonrpc: '2.0',
            id,
            result: { resources },
          };
        }

        case 'resources/read': {
          const uri = typeof params['uri'] === 'string' ? params['uri'] : '';
          const content = await this.mcpTools.readResource(uri);
          return {
            jsonrpc: '2.0',
            id,
            result: {
              contents: [content],
            },
          };
        }

        case 'prompts/list': {
          const prompts = this.mcpTools.listPrompts();
          return {
            jsonrpc: '2.0',
            id,
            result: { prompts },
          };
        }

        case 'prompts/get': {
          const name = typeof params['name'] === 'string' ? params['name'] : '';
          const promptArgs =
            typeof params['arguments'] === 'object' &&
            params['arguments'] !== null
              ? (params['arguments'] as Record<string, string>)
              : {};
          const prompt = this.mcpTools.getPrompt(name, promptArgs);
          return {
            jsonrpc: '2.0',
            id,
            result: prompt,
          };
        }

        default:
          return {
            jsonrpc: '2.0',
            id,
            error: {
              code: -32601,
              message: `Method not found: ${method}`,
            },
          };
      }
    } catch (err) {
      return {
        jsonrpc: '2.0',
        id,
        error: {
          code: -32603,
          message: err instanceof Error ? err.message : String(err),
        },
      };
    }
  }
}
