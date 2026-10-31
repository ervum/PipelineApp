import * as readline from 'node:readline';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { JsonRpcRequest, McpController } from './mcp.controller';

async function bootstrapStdio(): Promise<void> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error'],
  });
  const mcpController = app.get(McpController);

  const rl = readline.createInterface({
    input: process.stdin,
    terminal: false,
  });

  rl.on('line', (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    void (async () => {
      try {
        const parsed = JSON.parse(trimmed) as JsonRpcRequest;
        const response = await mcpController.processSingleRpc(parsed, 'STDIO');
        if (response) {
          process.stdout.write(JSON.stringify(response) + '\n');
        }
      } catch (err) {
        const errResp = {
          jsonrpc: '2.0',
          id: null,
          error: {
            code: -32700,
            message: `Parse error: ${err instanceof Error ? err.message : String(err)}`,
          },
        };
        process.stdout.write(JSON.stringify(errResp) + '\n');
      }
    })();
  });

  rl.on('close', () => {
    void app.close();
  });
}

void bootstrapStdio();
