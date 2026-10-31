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

interface RodinSubmitResponse {
  uuid?: string;
  jobs?: {
    subscription_key?: string;
  };
}

interface RodinStatusResponse {
  jobs?: Array<{
    uuid?: string;
    status?: string;
  }>;
}

interface RodinDownloadResponse {
  list?: Array<{
    url?: string;
    name?: string;
  }>;
}

@Injectable()
export class RodinAdapter extends BaseGeneratorAdapter {
  readonly id = 'rodin';
  readonly providerKind = ProviderKind.RODIN;
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
      ctx.provider.baseUrl || 'https://hyperhuman.deemos.com'
    ).replace(/\/$/, '');

    const params3d =
      ctx.params.modality === Modality.ASSETS_3D ? ctx.params : null;
    const outputFormat = params3d?.outputFormat ?? 'glb';
    const polycountTier = params3d?.polycountTier ?? 'MID_POLY';
    const quality =
      polycountTier === 'LOW_POLY'
        ? 'low'
        : polycountTier === 'HIGH_RES'
          ? 'high'
          : 'medium';

    const form = new FormData();
    form.append(
      'prompt',
      this.foldNegative(
        ctx.compiled.enhancedPrompt,
        ctx.compiled.negativePrompt,
      ),
    );
    form.append('geometry_file_format', outputFormat);
    form.append('material', 'PBR');
    form.append('quality', quality);
    form.append('seed', String(ctx.seed % 65535));
    form.append('tier', 'Regular');

    if (ctx.references.length > 0) {
      for (let i = 0; i < ctx.references.length; i++) {
        const ref = ctx.references[i]!;
        const b64 = await ref.base64();
        const buf = Buffer.from(b64, 'base64');
        form.append(
          'images',
          new Blob([buf], { type: ref.mimeType }),
          `image_${i}.png`,
        );
      }
    }

    const res = await this.http.request<RodinSubmitResponse>(
      `${baseUrl}/api/v2/rodin`,
      {
        method: 'POST',
        headers,
        body: form,
        timeoutMs: ctx.provider.settings.timeoutMs,
        signal: ctx.signal,
      },
    );

    const taskUuid = res.uuid;
    const subscriptionKey = res.jobs?.subscription_key;
    if (!taskUuid || !subscriptionKey) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'Rodin submit response missing uuid or subscription_key',
      );
    }

    return {
      mode: 'async',
      externalJobId: taskUuid,
      handle: {
        taskUuid,
        subscriptionKey,
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
      ctx.provider.baseUrl || 'https://hyperhuman.deemos.com'
    ).replace(/\/$/, '');

    const taskUuid = String(handle['taskUuid'] ?? ctx.job.externalJobId ?? '');
    const subscriptionKey = String(handle['subscriptionKey'] ?? '');
    const outputFormat = String(handle['outputFormat'] ?? 'glb');
    const submittedAt = Number(handle['submittedAt'] ?? Date.now());

    const statusRes = await this.http.request<RodinStatusResponse>(
      `${baseUrl}/api/v2/status`,
      {
        method: 'POST',
        headers,
        body: { subscription_key: subscriptionKey },
        timeoutMs: 30_000,
        signal: ctx.signal,
      },
    );

    const jobs = statusRes.jobs ?? [];
    const anyFailed = jobs.some((j) => j.status === 'Failed');
    if (anyFailed) {
      return {
        state: 'failed',
        externalStatus: 'Failed',
        code: ErrorCode.PROVIDER_ERROR,
        message: 'Rodin generation job failed',
        retryable: true,
      };
    }

    const allDone =
      jobs.length > 0 && jobs.every((j) => j.status === 'Done');
    if (!allDone) {
      const doneCount = jobs.filter((j) => j.status === 'Done').length;
      const progress =
        jobs.length > 0 ? Math.round((doneCount / jobs.length) * 90) : 40;
      return {
        state: 'pending',
        coldStart: false,
        externalStatus: 'InProgress',
        progress,
      };
    }

    const downloadRes = await this.http.request<RodinDownloadResponse>(
      `${baseUrl}/api/v2/download`,
      {
        method: 'POST',
        headers,
        body: { task_uuid: taskUuid },
        timeoutMs: 30_000,
        signal: ctx.signal,
      },
    );

    const items = downloadRes.list ?? [];
    const meshItem =
      items.find((it) => it.name?.toLowerCase().endsWith(`.${outputFormat}`)) ??
      items.find(
        (it) =>
          it.name?.toLowerCase().endsWith('.glb') ||
          it.name?.toLowerCase().endsWith('.fbx') ||
          it.name?.toLowerCase().endsWith('.obj'),
      ) ??
      items[0];

    if (!meshItem?.url) {
      return {
        state: 'failed',
        externalStatus: 'Done',
        code: ErrorCode.PROVIDER_ERROR,
        message: 'Rodin download returned no mesh URL',
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
        data: meshItem.url,
        mimeType: primaryMime,
        fileName: meshItem.name || `mesh.${outputFormat}`,
        role: AssetFileRole.PRIMARY,
        batchIndex: 0,
      },
    ];

    return {
      state: 'completed',
      outputs,
      externalStatus: 'Done',
      executionMs: Math.max(1, Date.now() - submittedAt),
    };
  }
}
