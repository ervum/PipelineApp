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

interface ReplicatePredictionResponse {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  output?: unknown;
  error?: string | null;
  metrics?: {
    predict_time?: number;
  };
}

@Injectable()
export class ReplicateAdapter extends BaseGeneratorAdapter {
  readonly id = 'replicate';
  readonly providerKind = ProviderKind.REPLICATE;
  readonly modalities = [
    Modality.IMAGES,
    Modality.ICONS_2D,
    Modality.VIDEO,
    Modality.MUSIC,
    Modality.SFX,
    Modality.ASSETS_3D,
  ] as const;
  readonly subModes = [
    GenerationSubMode.STANDARD,
    GenerationSubMode.TEXT_TO_VIDEO,
    GenerationSubMode.IMAGE_TO_VIDEO,
    GenerationSubMode.TEXT_TO_3D,
    GenerationSubMode.IMAGE_TO_3D,
  ] as const;
  readonly tier = ExecutionTier.CLOUD_API;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const headers = this.authHeaders(ctx.provider, 'Bearer');
    const baseUrl = (
      ctx.provider.baseUrl || 'https://api.replicate.com'
    ).replace(/\/$/, '');

    const fallbackModel =
      ctx.modality === Modality.MUSIC
        ? 'meta/musicgen'
        : ctx.modality === Modality.SFX
          ? 'sepal/audiogen'
          : ctx.modality === Modality.ASSETS_3D
            ? 'firtoz/trellis'
            : 'black-forest-labs/flux-1.1-pro';

    const modelSlug = this.pickModel(ctx, fallbackModel).replace(/^\/+/, '');
    const prompt = this.foldNegative(
      ctx.compiled.enhancedPrompt,
      ctx.compiled.negativePrompt,
    );

    const input: Record<string, unknown> = {};
    if (ctx.modality === Modality.MUSIC) {
      const durationSec =
        ctx.params.modality === Modality.MUSIC ? ctx.params.durationSec : 30;
      input['prompt'] = prompt;
      input['duration'] = durationSec;
      input['model_version'] = 'stereo-large';
      input['output_format'] = 'wav';
      input['normalization_strategy'] = 'peak';
      input['seed'] = ctx.seed;
    } else if (ctx.modality === Modality.SFX) {
      const durationSec =
        ctx.params.modality === Modality.SFX
          ? Math.round(ctx.params.durationSec)
          : 3;
      input['prompt'] = prompt;
      input['duration'] = Math.max(1, durationSec);
    } else if (ctx.modality === Modality.ASSETS_3D) {
      input['prompt'] = prompt;
      input['seed'] = ctx.seed;
      if (ctx.references.length > 0) {
        const ref = ctx.references[0]!;
        input['image'] = ref.publicUrl ?? (await ref.dataUri());
      }
    } else {
      const dims = this.sizeFor(ctx.params);
      const batchCount =
        'batchCount' in ctx.params && typeof ctx.params.batchCount === 'number'
          ? Math.max(1, ctx.params.batchCount)
          : 1;
      input['prompt'] = prompt;
      input['aspect_ratio'] = dims.aspectRatio;
      input['num_outputs'] = batchCount;
      input['seed'] = ctx.seed;
      input['output_format'] = 'png';
    }

    const res = await this.http.request<ReplicatePredictionResponse>(
      `${baseUrl}/v1/models/${modelSlug}/predictions`,
      {
        method: 'POST',
        headers,
        body: { input },
        timeoutMs: ctx.provider.settings.timeoutMs,
        signal: ctx.signal,
      },
    );

    if (!res.id) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'Replicate returned prediction without id',
      );
    }

    const isStarting = res.status === 'starting';
    ctx.reportWorker({
      externalJobId: res.id,
      externalStatus: res.status,
      phase: isStarting ? 'COLD_START' : 'RUNNING',
      coldStart: isStarting,
      queueDelayMs: null,
      workers: null,
    });

    return {
      mode: 'async',
      externalJobId: res.id,
      handle: {
        predictionId: res.id,
        submittedAt: Date.now(),
      },
      initialStatus: isStarting ? 'COLD_START' : 'RUNNING',
      pollAfterMs: ctx.provider.settings.pollIntervalMs,
    };
  }

  override async poll(
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
  ): Promise<GeneratorPollResult> {
    const headers = this.authHeaders(ctx.provider, 'Bearer');
    const baseUrl = (
      ctx.provider.baseUrl || 'https://api.replicate.com'
    ).replace(/\/$/, '');
    const predictionId = String(
      handle['predictionId'] ?? ctx.job.externalJobId ?? '',
    );

    const res = await this.http.request<ReplicatePredictionResponse>(
      `${baseUrl}/v1/predictions/${predictionId}`,
      {
        method: 'GET',
        headers,
        timeoutMs: 30_000,
        signal: ctx.signal,
      },
    );

    if (res.status === 'starting') {
      return {
        state: 'pending',
        coldStart: true,
        externalStatus: 'starting',
        progress: 10,
      };
    }

    if (res.status === 'processing') {
      return {
        state: 'pending',
        coldStart: false,
        externalStatus: 'processing',
        progress: 55,
      };
    }

    if (res.status === 'failed' || res.status === 'canceled') {
      return {
        state: 'failed',
        externalStatus: res.status,
        code: ErrorCode.PROVIDER_ERROR,
        message: res.error || `Replicate prediction ${res.status}`,
        retryable: res.status === 'failed',
      };
    }

    const urls = this.extractOutputUrls(res.output);
    if (urls.length === 0) {
      return {
        state: 'failed',
        externalStatus: 'succeeded',
        code: ErrorCode.PROVIDER_ERROR,
        message: 'Replicate prediction succeeded with empty output',
        retryable: false,
      };
    }

    const isAudio =
      ctx.modality === Modality.MUSIC || ctx.modality === Modality.SFX;
    const is3d = ctx.modality === Modality.ASSETS_3D;
    const ext = isAudio ? 'wav' : is3d ? 'glb' : 'png';
    const mimeType = isAudio
      ? 'audio/wav'
      : is3d
        ? 'model/gltf-binary'
        : 'image/png';

    const outputs: GeneratorOutput[] = urls.map((u, idx) => ({
      kind: 'url',
      data: u,
      mimeType,
      fileName: `output_${idx + 1}.${ext}`,
      role: AssetFileRole.PRIMARY,
      batchIndex: idx,
    }));

    const executionMs =
      typeof res.metrics?.predict_time === 'number'
        ? Math.round(res.metrics.predict_time * 1000)
        : undefined;

    return {
      state: 'completed',
      outputs,
      externalStatus: 'succeeded',
      executionMs,
    };
  }

  override async cancel(
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
  ): Promise<void> {
    const predictionId = String(
      handle['predictionId'] ?? ctx.job.externalJobId ?? '',
    );
    if (!predictionId) return;
    const headers = this.authHeaders(ctx.provider, 'Bearer');
    const baseUrl = (
      ctx.provider.baseUrl || 'https://api.replicate.com'
    ).replace(/\/$/, '');
    try {
      await this.http.request(
        `${baseUrl}/v1/predictions/${predictionId}/cancel`,
        {
          method: 'POST',
          headers,
          timeoutMs: 10_000,
          retries: 0,
        },
      );
    } catch {
      // Best-effort cancel
    }
  }

  private extractOutputUrls(output: unknown): string[] {
    if (typeof output === 'string' && output.length > 0) {
      return [output];
    }
    if (Array.isArray(output)) {
      return output.filter(
        (item): item is string => typeof item === 'string' && item.length > 0,
      );
    }
    if (typeof output === 'object' && output !== null) {
      const obj = output as Record<string, unknown>;
      for (const key of ['model_file', 'mesh', 'audio', 'image', 'url']) {
        const val = obj[key];
        if (typeof val === 'string' && val.length > 0) {
          return [val];
        }
      }
    }
    return [];
  }
}
