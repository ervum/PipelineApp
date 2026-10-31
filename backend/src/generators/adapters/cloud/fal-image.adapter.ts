import {
  AssetFileRole,
  ErrorCode,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';
import { HttpClientService } from '../../../common/http/http-client.service';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import {
  GeneratorDispatchContext,
  GeneratorOutput,
  GeneratorPollResult,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

interface FalQueueSubmitResponse {
  request_id: string;
  status_url: string;
  response_url: string;
  cancel_url?: string;
}

interface FalQueueStatusResponse {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED';
  queue_position?: number;
  error?: string;
}

interface FalImageResultResponse {
  images?: Array<{
    url: string;
    content_type?: string;
    width?: number;
    height?: number;
  }>;
}

@Injectable()
export class FalImageAdapter extends BaseGeneratorAdapter {
  readonly id = 'fal-image';
  readonly providerKind = ProviderKind.FAL;
  readonly modalities = [
    Modality.ICONS_2D,
    Modality.IMAGES,
    Modality.VIDEO,
    Modality.OTHER,
  ] as const;
  readonly subModes = [
    GenerationSubMode.STANDARD,
    GenerationSubMode.TEXT_TO_VIDEO,
    GenerationSubMode.IMAGE_TO_VIDEO,
    GenerationSubMode.SPRITESHEET,
    GenerationSubMode.VFX_TEXTURE,
  ] as const;
  readonly tier = ExecutionTier.CLOUD_API;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const headers = this.authHeaders(ctx.provider, 'Key');
    const baseUrl = (ctx.provider.baseUrl || 'https://queue.fal.run').replace(
      /\/$/,
      '',
    );

    const hasReference = ctx.references.length > 0;
    const rawModel = this.pickModel(ctx, 'fal-ai/flux-pro/v1.1');
    const modelPath =
      hasReference && !rawModel.includes('image-to-image')
        ? 'fal-ai/flux/dev/image-to-image'
        : rawModel.replace(/^\//, '');

    const prompt = this.foldNegative(
      ctx.compiled.enhancedPrompt,
      ctx.compiled.negativePrompt,
    );
    const dims = this.sizeFor(ctx.params);
    const batchCount =
      'batchCount' in ctx.params && typeof ctx.params.batchCount === 'number'
        ? Math.max(1, ctx.params.batchCount)
        : 1;

    const guidanceScale = this.num(ctx.mergedParams, 'guidance_scale', 3.5);
    const steps = Math.round(this.num(ctx.mergedParams, 'steps', 28));

    let imageUrl: string | undefined;
    if (hasReference) {
      const ref = ctx.references[0]!;
      imageUrl = ref.publicUrl ?? (await ref.dataUri());
    }

    const body: Record<string, unknown> = {
      prompt,
      image_size: { width: dims.width, height: dims.height },
      num_images: batchCount,
      seed: ctx.seed,
      guidance_scale: guidanceScale,
      num_inference_steps: steps,
      output_format: 'png',
      ...(imageUrl ? { image_url: imageUrl } : {}),
    };

    const res = await this.http.request<FalQueueSubmitResponse>(
      `${baseUrl}/${modelPath}`,
      {
        method: 'POST',
        headers,
        body,
        timeoutMs: ctx.provider.settings.timeoutMs,
        signal: ctx.signal,
      },
    );

    if (!res.request_id || !res.status_url || !res.response_url) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'fal.ai queue response missing request_id / status_url / response_url',
      );
    }

    const cancelUrl =
      res.cancel_url ??
      `${baseUrl}/${modelPath}/requests/${res.request_id}/cancel`;

    ctx.reportWorker({
      externalJobId: res.request_id,
      externalStatus: 'IN_QUEUE',
      phase: 'IN_QUEUE',
      coldStart: false,
      queueDelayMs: null,
      workers: null,
    });

    return {
      mode: 'async',
      externalJobId: res.request_id,
      handle: {
        requestId: res.request_id,
        statusUrl: res.status_url,
        responseUrl: res.response_url,
        cancelUrl,
        submittedAt: Date.now(),
      },
      initialStatus: 'RUNNING',
      pollAfterMs: ctx.provider.settings.pollIntervalMs,
    };
  }

  override async poll(
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
  ): Promise<GeneratorPollResult> {
    const headers = this.authHeaders(ctx.provider, 'Key');
    const statusUrl = String(handle['statusUrl'] ?? '');
    const responseUrl = String(handle['responseUrl'] ?? '');
    const submittedAt = Number(handle['submittedAt'] ?? Date.now());

    const statusRes = await this.http.request<FalQueueStatusResponse>(
      statusUrl,
      {
        method: 'GET',
        headers,
        timeoutMs: 30_000,
        signal: ctx.signal,
      },
    );

    if (statusRes.status === 'IN_QUEUE') {
      const queuePos = statusRes.queue_position ?? 0;
      const coldStart = queuePos > 1;
      ctx.reportWorker({
        externalJobId: String(handle['requestId'] ?? ''),
        externalStatus: `IN_QUEUE (pos ${queuePos})`,
        phase: coldStart ? 'COLD_START' : 'IN_QUEUE',
        coldStart,
        queueDelayMs: Date.now() - submittedAt,
        workers: null,
      });
      return {
        state: 'pending',
        coldStart,
        externalStatus: 'IN_QUEUE',
        progress: 10,
      };
    }

    if (statusRes.status === 'IN_PROGRESS') {
      return {
        state: 'pending',
        coldStart: false,
        externalStatus: 'IN_PROGRESS',
        progress: 60,
      };
    }

    if (statusRes.status === 'FAILED') {
      return {
        state: 'failed',
        externalStatus: 'FAILED',
        code: ErrorCode.PROVIDER_ERROR,
        message: statusRes.error || 'fal.ai generation failed',
        retryable: true,
      };
    }

    const resultRes = await this.http.request<FalImageResultResponse>(
      responseUrl,
      {
        method: 'GET',
        headers,
        timeoutMs: 60_000,
        signal: ctx.signal,
      },
    );

    const images = resultRes.images ?? [];
    if (images.length === 0) {
      return {
        state: 'failed',
        externalStatus: 'COMPLETED',
        code: ErrorCode.PROVIDER_ERROR,
        message: 'fal.ai completed with zero images',
        retryable: false,
      };
    }

    const outputs: GeneratorOutput[] = images.map((img, idx) => ({
      kind: 'url',
      data: img.url,
      mimeType: img.content_type || 'image/png',
      fileName: `image_${idx + 1}.png`,
      role: AssetFileRole.PRIMARY,
      batchIndex: idx,
    }));

    return {
      state: 'completed',
      outputs,
      externalStatus: 'COMPLETED',
      executionMs: Math.max(1, Date.now() - submittedAt),
    };
  }

  override async cancel(
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
  ): Promise<void> {
    const cancelUrl = handle['cancelUrl'];
    if (typeof cancelUrl !== 'string' || !cancelUrl) {
      return;
    }
    const headers = this.authHeaders(ctx.provider, 'Key');
    try {
      await this.http.request(cancelUrl, {
        method: 'PUT',
        headers,
        timeoutMs: 10_000,
        retries: 0,
      });
    } catch {
      // Best-effort cancel
    }
  }
}
