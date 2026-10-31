import { ErrorCode } from '@forge/shared';
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { DomainError } from '../common/errors/domain.error';
import { RunPodStatusResponse } from './adapters/runpod/runpod-client';
import { JobProcessorService } from './job-processor.service';

@Controller('webhooks')
export class WebhooksController {
  constructor(private readonly processor: JobProcessorService) {}

  @Post('runpod/:jobId')
  @HttpCode(HttpStatus.OK)
  async handleRunPodWebhook(
    @Param('jobId') jobId: string,
    @Query('token') token: string | undefined,
    @Body() body: RunPodStatusResponse,
  ): Promise<{ ok: boolean }> {
    if (!token || typeof token !== 'string') {
      throw new DomainError(
        ErrorCode.PROVIDER_AUTH_FAILED,
        401,
        'Missing webhook signature token',
      );
    }

    const expectedHex = this.processor.signWebhookToken(jobId);
    const expectedBuf = Buffer.from(expectedHex, 'utf8');
    const actualBuf = Buffer.from(token, 'utf8');

    if (
      expectedBuf.length !== actualBuf.length ||
      !timingSafeEqual(expectedBuf, actualBuf)
    ) {
      throw new DomainError(
        ErrorCode.PROVIDER_AUTH_FAILED,
        401,
        'Invalid webhook signature token',
      );
    }

    await this.processor.handleRemoteResult(jobId, body);
    return { ok: true };
  }
}
