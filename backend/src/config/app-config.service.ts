import * as path from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppEnv } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<AppEnv, true>) {}

  get nodeEnv(): 'development' | 'test' | 'production' {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get databaseUrl(): string {
    return this.config.get('DATABASE_URL', { infer: true });
  }

  get forgeMasterKey(): Buffer {
    const raw = this.config.get('FORGE_MASTER_KEY', { infer: true });
    return Buffer.from(raw.trim(), 'base64');
  }

  get storageDriver(): 'local' | 's3' {
    return this.config.get('STORAGE_DRIVER', { infer: true });
  }

  get storageRoot(): string {
    const raw = this.config.get('STORAGE_ROOT', { infer: true });
    if (path.isAbsolute(raw)) {
      return raw;
    }
    const baseDir = path.basename(process.cwd()) === 'backend'
      ? process.cwd()
      : path.resolve(process.cwd(), 'backend');
    return path.resolve(baseDir, raw);
  }

  get s3Endpoint(): string {
    return this.config.get('S3_ENDPOINT', { infer: true });
  }

  get s3Region(): string {
    return this.config.get('S3_REGION', { infer: true });
  }

  get s3Bucket(): string {
    return this.config.get('S3_BUCKET', { infer: true });
  }

  get s3AccessKeyId(): string {
    return this.config.get('S3_ACCESS_KEY_ID', { infer: true });
  }

  get s3SecretAccessKey(): string {
    return this.config.get('S3_SECRET_ACCESS_KEY', { infer: true });
  }

  get s3ForcePathStyle(): boolean {
    return this.config.get('S3_FORCE_PATH_STYLE', { infer: true });
  }

  get publicWebhookBaseUrl(): string | null {
    const val = this.config.get('PUBLIC_WEBHOOK_BASE_URL', { infer: true }).trim();
    return val.length > 0 ? val.replace(/\/+$/, '') : null;
  }

  get webhookSigningSecret(): string {
    return this.config.get('WEBHOOK_SIGNING_SECRET', { infer: true });
  }

  get corsOrigin(): string | string[] {
    const raw = this.config.get('CORS_ORIGIN', { infer: true });
    if (raw.includes(',')) {
      return raw.split(',').map((s) => s.trim());
    }
    return raw.trim();
  }

  get jobWorkerTickMs(): number {
    return this.config.get('JOB_WORKER_TICK_MS', { infer: true });
  }

  get jobMaxConcurrentGlobal(): number {
    return this.config.get('JOB_MAX_CONCURRENT_GLOBAL', { infer: true });
  }

  get maxUploadMb(): number {
    return this.config.get('MAX_UPLOAD_MB', { infer: true });
  }

  get maxUploadBytes(): number {
    return this.maxUploadMb * 1024 * 1024;
  }
}
