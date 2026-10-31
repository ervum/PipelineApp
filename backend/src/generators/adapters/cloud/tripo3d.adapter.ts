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

interface TripoUploadResponse {
  code?: number;
  data?: {
    image_token?: string;
  };
}

interface TripoTaskCreateResponse {
  code?: number;
  data?: {
    task_id?: string;
  };
}

interface TripoTaskStatusResponse {
  code?: number;
  data?: {
    task_id?: string;
    status?:
      | 'queued'
      | 'running'
      | 'success'
      | 'failed'
      | 'banned'
      | 'expired'
      | 'cancelled';
    progress?: number;
    output?: {
      pbr_model?: string;
      model?: string;
      rendered_image?: string;
    };
  };
}

@Injectable()
export class Tripo3dAdapter extends BaseGeneratorAdapter {
  readonly id = 'tripo3d';
  readonly providerKind = ProviderKind.TRIPO3D;
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
      ctx.provider.baseUrl || 'https://api.tripo3d.ai'
    ).replace(/\/$/, '');

    const params3d =
      ctx.params.modality === Modality.ASSETS_3D ? ctx.params : null;
    const outputFormat = params3d?.outputFormat ?? 'glb';
    const faceLimit = Math.round(
      this.num(ctx.mergedParams, 'target_polycount', 10000),
    );

    let taskBody: Record<string, unknown>;
    if (ctx.subMode === GenerationSubMode.IMAGE_TO_3D) {
      const ref = ctx.references[0];
      if (!ref) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          400,
          'Tripo3D IMAGE_TO_3D requires a reference image',
        );
      }
      const b64 = await ref.base64();
      const buf = Buffer.from(b64, 'base64');
      const uploadForm = new FormData();
      uploadForm.append(
        'file',
        new Blob([buf], { type: ref.mimeType }),
        'reference.png',
      );
      const uploadRes = await this.http.request<TripoUploadResponse>(
        `${baseUrl}/v2/openapi/upload`,
        {
          method: 'POST',
          headers,
          body: uploadForm,
          timeoutMs: ctx.provider.settings.timeoutMs,
          signal: ctx.signal,
        },
      );
      const imageToken = uploadRes.data?.image_token;
      if (!imageToken) {
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          'Tripo3D upload returned no image_token',
        );
      }
      taskBody = {
        type: 'image_to_model',
        file: {
          type: 'png',
          file_token: imageToken,
        },
        model_seed: ctx.seed,
        face_limit: faceLimit,
      };
    } else {
      taskBody = {
        type: 'text_to_model',
        prompt: ctx.compiled.enhancedPrompt,
        negative_prompt: ctx.compiled.negativePrompt,
        model_seed: ctx.seed,
        face_limit: faceLimit,
      };
    }

    const res = await this.http.request<TripoTaskCreateResponse>(
      `${baseUrl}/v2/openapi/task`,
      {
        method: 'POST',
        headers,
        body: taskBody,
        timeoutMs: ctx.provider.settings.timeoutMs,
        signal: ctx.signal,
      },
    );

    const taskId = res.data?.task_id;
    if (!taskId) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'Tripo3D task creation returned no task_id',
      );
    }

    return {
      mode: 'async',
      externalJobId: taskId,
      handle: {
        stage: 'generate',
        taskId,
        outputFormat,
        renderedImageUrl: null,
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
      ctx.provider.baseUrl || 'https://api.tripo3d.ai'
    ).replace(/\/$/, '');

    const stage = String(handle['stage'] ?? 'generate');
    const taskId = String(handle['taskId'] ?? ctx.job.externalJobId ?? '');
    const outputFormat = String(handle['outputFormat'] ?? 'glb');
    const submittedAt = Number(handle['submittedAt'] ?? Date.now());

    const statusRes = await this.http.request<TripoTaskStatusResponse>(
      `${baseUrl}/v2/openapi/task/${taskId}`,
      {
        method: 'GET',
        headers,
        timeoutMs: 30_000,
        signal: ctx.signal,
      },
    );

    const data = statusRes.data;
    const status = data?.status ?? 'queued';
    const progress = data?.progress ?? 0;

    if (status === 'queued') {
      return {
        state: 'pending',
        coldStart: true,
        externalStatus: `${stage}:queued`,
        progress: stage === 'convert' ? 75 : 10,
      };
    }

    if (status === 'running') {
      return {
        state: 'pending',
        coldStart: false,
        externalStatus: `${stage}:running`,
        progress:
          stage === 'convert'
            ? 75 + Math.round(progress * 0.25)
            : Math.round(progress * (outputFormat === 'glb' ? 1 : 0.75)),
      };
    }

    if (
      status === 'failed' ||
      status === 'banned' ||
      status === 'expired' ||
      status === 'cancelled'
    ) {
      return {
        state: 'failed',
        externalStatus: status,
        code: ErrorCode.PROVIDER_ERROR,
        message: `Tripo3D task ${status}`,
        retryable: status === 'failed' || status === 'expired',
      };
    }

    // success
    if (
      stage === 'generate' &&
      (outputFormat === 'fbx' || outputFormat === 'obj')
    ) {
      if (data?.output?.rendered_image) {
        handle['renderedImageUrl'] = data.output.rendered_image;
      }
      const convertRes = await this.http.request<TripoTaskCreateResponse>(
        `${baseUrl}/v2/openapi/task`,
        {
          method: 'POST',
          headers,
          body: {
            type: 'convert_model',
            original_model_task_id: taskId,
            format: outputFormat.toUpperCase(),
          },
          timeoutMs: ctx.provider.settings.timeoutMs,
          signal: ctx.signal,
        },
      );
      const convertTaskId = convertRes.data?.task_id;
      if (!convertTaskId) {
        return {
          state: 'failed',
          externalStatus: 'CONVERT_SUBMIT_FAILED',
          code: ErrorCode.PROVIDER_ERROR,
          message: 'Tripo3D convert_model returned no task_id',
          retryable: true,
        };
      }
      handle['stage'] = 'convert';
      handle['taskId'] = convertTaskId;
      return {
        state: 'pending',
        coldStart: false,
        externalStatus: 'convert:queued',
        progress: 75,
      };
    }

    const modelUrl = data?.output?.pbr_model ?? data?.output?.model;
    if (!modelUrl) {
      return {
        state: 'failed',
        externalStatus: 'success',
        code: ErrorCode.PROVIDER_ERROR,
        message: 'Tripo3D task succeeded with no model URL in output',
        retryable: false,
      };
    }

    const primaryMime =
      outputFormat === 'fbx'
        ? 'application/octet-stream'
        : outputFormat === 'obj'
          ? 'text/plain'
          : 'model/gltf-binary';

    const outputs: GeneratorOutput[] = [
      {
        kind: 'url',
        data: modelUrl,
        mimeType: primaryMime,
        fileName: `mesh.${outputFormat}`,
        role: AssetFileRole.PRIMARY,
        batchIndex: 0,
      },
    ];

    const thumbUrl =
      data?.output?.rendered_image ??
      (typeof handle['renderedImageUrl'] === 'string'
        ? handle['renderedImageUrl']
        : undefined);
    if (thumbUrl) {
      outputs.push({
        kind: 'url',
        data: thumbUrl,
        mimeType: 'image/png',
        fileName: 'thumbnail.png',
        role: AssetFileRole.THUMBNAIL,
        batchIndex: 0,
      });
    }

    return {
      state: 'completed',
      outputs,
      externalStatus: 'success',
      executionMs: Math.max(1, Date.now() - submittedAt),
    };
  }
}
