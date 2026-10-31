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
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

interface A1111GenerateResponse {
  images?: string[];
}

interface A1111ProgressResponse {
  progress?: number;
  eta_relative?: number;
}

@Injectable()
export class A1111Adapter extends BaseGeneratorAdapter {
  readonly id = 'a1111';
  readonly providerKind = ProviderKind.A1111;
  readonly modalities = [
    Modality.ICONS_2D,
    Modality.IMAGES,
    Modality.OTHER,
  ] as const;
  readonly subModes = [
    GenerationSubMode.STANDARD,
    GenerationSubMode.SPRITESHEET,
    GenerationSubMode.VFX_TEXTURE,
  ] as const;
  readonly tier = ExecutionTier.LOCAL;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const baseUrl = (
      ctx.provider.baseUrl || 'http://127.0.0.1:7860'
    ).replace(/\/$/, '');
    const headers = this.authHeaders(ctx.provider, 'none');

    const dims = this.sizeFor(ctx.params);
    const batchCount =
      'batchCount' in ctx.params && typeof ctx.params.batchCount === 'number'
        ? Math.max(1, ctx.params.batchCount)
        : 1;

    const steps = Math.round(this.num(ctx.mergedParams, 'steps', 28));
    const cfgScale = this.num(
      ctx.mergedParams,
      'cfg_scale',
      this.num(ctx.mergedParams, 'guidance_scale', 7.0),
    );
    const samplerName = this.str(ctx.mergedParams, 'sampler_name', 'DPM++ 2M');

    const hasRef = ctx.references.length > 0;
    const endpoint = hasRef ? '/sdapi/v1/img2img' : '/sdapi/v1/txt2img';

    const body: Record<string, unknown> = {
      prompt: ctx.compiled.enhancedPrompt,
      negative_prompt: ctx.compiled.negativePrompt,
      steps,
      cfg_scale: cfgScale,
      width: dims.width,
      height: dims.height,
      seed: ctx.seed,
      sampler_name: samplerName,
      batch_size: batchCount,
    };

    if (hasRef) {
      const ref = ctx.references[0]!;
      const b64 = await ref.base64();
      body['init_images'] = [b64];
      body['denoising_strength'] =
        ctx.params.modality === Modality.IMAGES
          ? (ctx.params.referenceStrength ?? 0.65)
          : 0.65;
    }

    let finished = false;
    const progressTimer = setInterval(() => {
      if (finished || ctx.signal.aborted) return;
      void this.http
        .request<A1111ProgressResponse>(`${baseUrl}/sdapi/v1/progress`, {
          method: 'GET',
          headers,
          timeoutMs: 3_000,
          retries: 0,
        })
        .then((prog) => {
          if (finished) return;
          if (typeof prog.progress === 'number' && prog.progress > 0) {
            ctx.reportProgress({
              percent: Math.min(99, Math.round(prog.progress * 100)),
              stage: 'sampling',
            });
          }
        })
        .catch(() => {
          // Ignore progress poll failures
        });
    }, 1000);
    progressTimer.unref?.();

    let res: A1111GenerateResponse;
    try {
      res = await this.http.request<A1111GenerateResponse>(
        `${baseUrl}${endpoint}`,
        {
          method: 'POST',
          headers,
          body,
          timeoutMs: ctx.provider.settings.timeoutMs,
          signal: ctx.signal,
        },
      );
    } finally {
      finished = true;
      clearInterval(progressTimer);
    }

    const images = res.images ?? [];
    if (images.length === 0) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'Automatic1111 returned empty images[] array',
      );
    }

    const outputs: GeneratorOutput[] = images.map((b64, idx) => ({
      kind: 'base64',
      data: b64.replace(/^data:[^,]+,/, ''),
      mimeType: 'image/png',
      fileName: `image_${idx + 1}.png`,
      role: AssetFileRole.PRIMARY,
      batchIndex: idx,
    }));

    return {
      mode: 'sync',
      outputs,
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
