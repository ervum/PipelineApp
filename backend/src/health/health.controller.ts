import { Controller, Get } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export interface HealthResponse {
  status: 'ok' | 'degraded';
  db: boolean;
  storage: boolean;
  version: string;
  webhooksEnabled: boolean;
}

@Controller()
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly config: AppConfigService,
  ) {}

  @Get(['health', 'api/v1/health'])
  async check(): Promise<HealthResponse> {
    let dbOk = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    let storageOk = false;
    try {
      await this.storage.stat('projects/__health_probe__');
      storageOk = true;
    } catch {
      storageOk = false;
    }

    return {
      status: dbOk && storageOk ? 'ok' : 'degraded',
      db: dbOk,
      storage: storageOk,
      version: '1.0.0',
      webhooksEnabled: Boolean(this.config.publicWebhookBaseUrl),
    };
  }
}
