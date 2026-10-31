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

interface MeshySubmitResponse {
  result?: string;
}

interface MeshyTaskStatusResponse {
  id: string;
  status: 'PENDING' | 'IN_PROGRESS' | 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'CANCELED';
  progress?: number;
  model_urls?: Record<string, string | undefined>;
  thumbnail_url?: string;
  texture_urls?: Array<{
    base_color?: string;
    normal?: string;
    metallic?: string;
    roughness?: string;
  }>;
  task_error?: {
    message?: string;
  };
}

@Injectable()
export class MeshyAdapter extends BaseGeneratorAdapter {
  readonly id = 'meshy';
  readonly providerKind = ProviderKind.MESHY;
  readonly modalities = [Modality.ASSETS_3D] as const;
  readonly subModes = [
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
      ctx.provider.baseUrl || 'https://api.meshy.ai'
    ).replace(/\/$/, '');

    const params3d =
      ctx.params.modality === Modality.ASSETS_3D ? ctx.params : null;
    const topology = (params3d?.topology ?? 'QUAD').toLowerCase();
    const enablePbr = params3d?.enablePbr ?? true;
    const polycountTier = params3d?.polycountTier ?? 'MID_POLY';
    const defaultPolycount =
      polycountTier === 'LOW_POLY'
        ? 3000
        : polycountTier === 'HIGH_RES'
          ? 25000
          : 10000;
    const targetPolycount = Math.round(
      this.num(ctx.mergedParams, 'target_polycount', defaultPolycount),
    );
    const artStyle = this.str(ctx.mergedParams, 'art_style', 'realistic');
    const outputFormat = params3d?.outputFormat ?? 'glb';

    if (ctx.subMode === GenerationSubMode.IMAGE_TO_3D) {
      const ref = ctx.references[0];
      if (!ref) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          400,
          'Meshy IMAGE_TO_3D requires a reference image',
        );
      }
      const imageUrl = ref.publicUrl ?? (await ref.dataUri());
      const res = await this.http.request<MeshySubmitResponse>(
        `${baseUrl}/openapi/v1/image-to-3d`,
        {
          method: 'POST',
          headers,
          body: {
            image_url: imageUrl,
            enable_pbr: enablePbr,
            should_remesh: true,
            topology,
            target_polycount: targetPolycount,
          },
          timeoutMs: ctx.provider.settings.timeoutMs,
          signal: ctx.signal,
        },
      );
      if (!res.result) {
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          'Meshy image-to-3d response missing task id',
        );
      }
      return {
        mode: 'async',
        externalJobId: res.result,
        handle: {
          mode: 'image-to-3d',
          stage: 'single',
          taskId: res.result,
          enablePbr,
          outputFormat,
          submittedAt: Date.now(),
        },
        initialStatus: 'RUNNING',
        pollAfterMs: ctx.provider.settings.pollIntervalMs,
      };
    }

    const res = await this.http.request<MeshySubmitResponse>(
      `${baseUrl}/openapi/v2/text-to-3d`,
      {
        method: 'POST',
        headers,
        body: {
          mode: 'preview',
          prompt: ctx.compiled.enhancedPrompt,
          negative_prompt: ctx.compiled.negativePrompt,
          art_style: artStyle,
          topology,
          target_polycount: targetPolycount,
          should_remesh: true,
          seed: ctx.seed,
        },
        timeoutMs: ctx.provider.settings.timeoutMs,
        signal: ctx.signal,
      },
    );

    if (!res.result) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'Meshy text-to-3d preview response missing task id',
      );
    }

    return {
      mode: 'async',
      externalJobId: res.result,
      handle: {
        mode: 'text-to-3d',
        stage: 'preview',
        taskId: res.result,
        enablePbr,
        outputFormat,
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
    const headers = this.authHeaders(ctx.provider, 'Bearer');
    const baseUrl = (
      ctx.provider.baseUrl || 'https://api.meshy.ai'
    ).replace(/\/$/, '');

    const mode = String(handle['mode'] ?? 'text-to-3d');
    const stage = String(handle['stage'] ?? 'preview');
    const taskId = String(handle['taskId'] ?? ctx.job.externalJobId ?? '');
    const enablePbr = Boolean(handle['enablePbr'] ?? true);
    const outputFormat = String(handle['outputFormat'] ?? 'glb');
    const submittedAt = Number(handle['submittedAt'] ?? Date.now());

    const statusEndpoint =
      mode === 'image-to-3d'
        ? `${baseUrl}/openapi/v1/image-to-3d/${taskId}`
        : `${baseUrl}/openapi/v2/text-to-3d/${taskId}`;

    const statusRes = await this.http.request<MeshyTaskStatusResponse>(
      statusEndpoint,
      {
        method: 'GET',
        headers,
        timeoutMs: 30_000,
        signal: ctx.signal,
      },
    );

    const rawProgress = Math.max(0, Math.min(100, statusRes.progress ?? 0));
    const mappedProgress =
      mode === 'text-to-3d' && enablePbr
        ? stage === 'preview'
          ? Math.round(rawProgress * 0.5)
          : 50 + Math.round(rawProgress * 0.5)
        : rawProgress;

    if (statusRes.status === 'PENDING') {
      return {
        state: 'pending',
        coldStart: true,
        externalStatus: `${stage.toUpperCase()}:PENDING`,
        progress: mappedProgress,
      };
    }

    if (statusRes.status === 'IN_PROGRESS') {
      return {
        state: 'pending',
        coldStart: false,
        externalStatus: `${stage.toUpperCase()}:IN_PROGRESS`,
        progress: mappedProgress,
      };
    }

    if (
      statusRes.status === 'FAILED' ||
      statusRes.status === 'EXPIRED' ||
      statusRes.status === 'CANCELED'
    ) {
      return {
        state: 'failed',
        externalStatus: statusRes.status,
        code: ErrorCode.PROVIDER_ERROR,
        message:
          statusRes.task_error?.message ||
          `Meshy ${stage} task ${statusRes.status}`,
        retryable: statusRes.status !== 'CANCELED',
      };
    }

    // SUCCEEDED
    if (mode === 'text-to-3d' && stage === 'preview' && enablePbr) {
      const refineRes = await this.http.request<MeshySubmitResponse>(
        `${baseUrl}/openapi/v2/text-to-3d`,
        {
          method: 'POST',
          headers,
          body: {
            mode: 'refine',
            preview_task_id: taskId,
            enable_pbr: true,
            texture_prompt: ctx.compiled.enhancedPrompt,
          },
          timeoutMs: ctx.provider.settings.timeoutMs,
          signal: ctx.signal,
        },
      );
      if (!refineRes.result) {
        return {
          state: 'failed',
          externalStatus: 'REFINE_SUBMIT_FAILED',
          code: ErrorCode.PROVIDER_ERROR,
          message: 'Meshy refine stage returned no task id',
          retryable: true,
        };
      }
      handle['stage'] = 'refine';
      handle['previewTaskId'] = taskId;
      handle['taskId'] = refineRes.result;
      return {
        state: 'pending',
        coldStart: false,
        externalStatus: 'REFINE:PENDING',
        progress: 50,
      };
    }

    const modelUrls = statusRes.model_urls ?? {};
    const primaryUrl =
      modelUrls[outputFormat] ??
      modelUrls['glb'] ??
      modelUrls['fbx'] ??
      modelUrls['obj'];

    if (!primaryUrl) {
      return {
        state: 'failed',
        externalStatus: 'SUCCEEDED',
        code: ErrorCode.PROVIDER_ERROR,
        message: 'Meshy task succeeded without model_urls',
        retryable: false,
      };
    }

    const chosenFormat = modelUrls[outputFormat] ? outputFormat : 'glb';
    const primaryMime =
      chosenFormat === 'fbx'
        ? 'application/octet-stream'
        : chosenFormat === 'obj'
          ? 'text/plain'
          : 'model/gltf-binary';

    const outputs: GeneratorOutput[] = [
      {
        kind: 'url',
        data: primaryUrl,
        mimeType: primaryMime,
        fileName: `mesh.${chosenFormat}`,
        role: AssetFileRole.PRIMARY,
        batchIndex: 0,
      },
    ];

    if (statusRes.thumbnail_url) {
      outputs.push({
        kind: 'url',
        data: statusRes.thumbnail_url,
        mimeType: 'image/png',
        fileName: 'thumbnail.png',
        role: AssetFileRole.THUMBNAIL,
        batchIndex: 0,
      });
    }

    const tex = statusRes.texture_urls?.[0];
    if (tex?.base_color) {
      outputs.push({
        kind: 'url',
        data: tex.base_color,
        mimeType: 'image/png',
        fileName: 'base_color.png',
        role: AssetFileRole.TEXTURE_BASE_COLOR,
        batchIndex: 0,
      });
    }
    if (tex?.normal) {
      outputs.push({
        kind: 'url',
        data: tex.normal,
        mimeType: 'image/png',
        fileName: 'normal.png',
        role: AssetFileRole.TEXTURE_NORMAL,
        batchIndex: 0,
      });
    }
    if (tex?.metallic || tex?.roughness) {
      outputs.push({
        kind: 'url',
        data: (tex.metallic ?? tex.roughness)!,
        mimeType: 'image/png',
        fileName: 'orm.png',
        role: AssetFileRole.TEXTURE_ORM,
        batchIndex: 0,
      });
    }

    return {
      state: 'completed',
      outputs,
      externalStatus: 'SUCCEEDED',
      executionMs: Math.max(1, Date.now() - submittedAt),
    };
  }
}
