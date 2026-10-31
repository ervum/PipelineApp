import {
  AssetFileRole,
  ErrorCode,
  ExecutionTier,
  GenerationSubMode,
  interpolateTemplate,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';
import { HttpClientService } from '../../../common/http/http-client.service';
import { mimeForExtension } from '../../../common/utils/mime';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import {
  GeneratorDispatchContext,
  GeneratorOutput,
  GeneratorPollResult,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';
import { ComfyUiWsClient } from './comfyui-ws.client';

interface ComfyUploadResponse {
  name?: string;
  subfolder?: string;
  type?: string;
}

interface ComfyPromptResponse {
  prompt_id?: string;
  number?: number;
  node_errors?: Record<string, unknown>;
}

interface ComfyFileEntry {
  filename: string;
  subfolder?: string;
  type?: string;
}

interface ComfyHistoryEntry {
  outputs?: Record<
    string,
    {
      images?: ComfyFileEntry[];
      gifs?: ComfyFileEntry[];
      audio?: ComfyFileEntry[];
      '3d'?: ComfyFileEntry[];
    }
  >;
  status?: {
    status_str?: string;
    completed?: boolean;
  };
}

@Injectable()
export class ComfyUiAdapter extends BaseGeneratorAdapter {
  readonly id = 'comfyui';
  readonly providerKind = ProviderKind.COMFYUI;
  readonly modalities = [
    Modality.ICONS_2D,
    Modality.IMAGES,
    Modality.VIDEO,
    Modality.OTHER,
    Modality.ASSETS_3D,
  ] as const;
  readonly subModes = [
    GenerationSubMode.STANDARD,
    GenerationSubMode.TEXT_TO_VIDEO,
    GenerationSubMode.IMAGE_TO_VIDEO,
    GenerationSubMode.SPRITESHEET,
    GenerationSubMode.VFX_TEXTURE,
    GenerationSubMode.TEXT_TO_3D,
    GenerationSubMode.IMAGE_TO_3D,
  ] as const;
  readonly tier = ExecutionTier.LOCAL;

  private readonly clients = new Map<string, ComfyUiWsClient>();

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const baseUrl = (
      ctx.provider.baseUrl || 'http://127.0.0.1:8188'
    ).replace(/\/$/, '');
    const headers = this.authHeaders(ctx.provider, 'none');

    const workflowTemplate = ctx.provider.workflowTemplate;
    if (!workflowTemplate || typeof workflowTemplate !== 'object') {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        `ComfyUI provider "${ctx.provider.name}" is missing workflowTemplate`,
      );
    }

    const clientId = `forge-${ctx.job.id}`;
    const wsUrl = `${baseUrl.replace(/^http/i, 'ws')}/ws?clientId=${encodeURIComponent(clientId)}`;
    const wsClient = new ComfyUiWsClient(wsUrl, (pct, stage) => {
      ctx.reportProgress({ percent: pct, stage });
    });
    await wsClient.connect();
    this.clients.set(ctx.job.id, wsClient);

    let referenceImageName = '';
    if (ctx.references.length > 0) {
      const ref = ctx.references[0]!;
      const b64 = await ref.base64();
      const buf = Buffer.from(b64, 'base64');
      const form = new FormData();
      form.append(
        'image',
        new Blob([buf], { type: ref.mimeType }),
        `forge_ref_${ctx.job.id}.png`,
      );
      form.append('overwrite', 'true');
      const uploadRes = await this.http.request<ComfyUploadResponse>(
        `${baseUrl}/upload/image`,
        {
          method: 'POST',
          headers,
          body: form,
          timeoutMs: 30_000,
          signal: ctx.signal,
        },
      );
      referenceImageName = uploadRes.name || `forge_ref_${ctx.job.id}.png`;
    }

    const dims = this.sizeFor(ctx.params);
    const batchCount =
      'batchCount' in ctx.params && typeof ctx.params.batchCount === 'number'
        ? Math.max(1, ctx.params.batchCount)
        : 1;

    const vars: Record<string, unknown> = {
      enhanced_prompt: ctx.compiled.enhancedPrompt,
      negative_prompt: ctx.compiled.negativePrompt,
      raw_prompt: ctx.job.rawPrompt,
      seed: ctx.seed,
      width: dims.width,
      height: dims.height,
      steps: Math.round(this.num(ctx.mergedParams, 'steps', 25)),
      cfg_scale: this.num(
        ctx.mergedParams,
        'cfg_scale',
        this.num(ctx.mergedParams, 'guidance_scale', 7.0),
      ),
      batch_count: batchCount,
      reference_image_name: referenceImageName,
      model: this.pickModel(ctx, 'v1-5-pruned-emaonly.safetensors'),
      job_id: ctx.job.id,
      params: ctx.mergedParams,
    };

    const workflow = interpolateTemplate(workflowTemplate, vars).value;

    const res = await this.http.request<ComfyPromptResponse>(
      `${baseUrl}/prompt`,
      {
        method: 'POST',
        headers,
        body: {
          prompt: workflow,
          client_id: clientId,
        },
        timeoutMs: ctx.provider.settings.timeoutMs,
        signal: ctx.signal,
      },
    );

    if (!res.prompt_id) {
      wsClient.close();
      this.clients.delete(ctx.job.id);
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'ComfyUI /prompt response missing prompt_id',
      );
    }

    wsClient.setPromptId(res.prompt_id);

    return {
      mode: 'async',
      externalJobId: res.prompt_id,
      handle: {
        promptId: res.prompt_id,
        clientId,
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
    const baseUrl = (
      ctx.provider.baseUrl || 'http://127.0.0.1:8188'
    ).replace(/\/$/, '');
    const headers = this.authHeaders(ctx.provider, 'none');
    const promptId = String(handle['promptId'] ?? ctx.job.externalJobId ?? '');
    const submittedAt = Number(handle['submittedAt'] ?? Date.now());

    const wsClient = this.clients.get(ctx.job.id);
    const wsState = wsClient?.getState();

    if (wsState?.error) {
      wsClient?.close();
      this.clients.delete(ctx.job.id);
      return {
        state: 'failed',
        externalStatus: 'execution_error',
        code: ErrorCode.PROVIDER_ERROR,
        message: wsState.error,
        retryable: false,
      };
    }

    const historyRes = await this.http.request<
      Record<string, ComfyHistoryEntry | undefined>
    >(`${baseUrl}/history/${encodeURIComponent(promptId)}`, {
      method: 'GET',
      headers,
      timeoutMs: 15_000,
      signal: ctx.signal,
    });

    const entry = historyRes[promptId];
    if (!entry || !entry.outputs) {
      return {
        state: 'pending',
        coldStart: false,
        externalStatus: 'RUNNING',
        progress: wsState?.progressPercent ?? 30,
      };
    }

    wsClient?.close();
    this.clients.delete(ctx.job.id);

    const fileEntries: ComfyFileEntry[] = [];
    for (const nodeOut of Object.values(entry.outputs)) {
      for (const bucket of [
        nodeOut.images,
        nodeOut.gifs,
        nodeOut.audio,
        nodeOut['3d'],
      ]) {
        if (Array.isArray(bucket)) {
          fileEntries.push(...bucket);
        }
      }
    }

    if (fileEntries.length === 0) {
      return {
        state: 'failed',
        externalStatus: 'COMPLETED',
        code: ErrorCode.PROVIDER_ERROR,
        message: 'ComfyUI history contained no output files',
        retryable: false,
      };
    }

    const outputs: GeneratorOutput[] = [];
    for (let i = 0; i < fileEntries.length; i++) {
      const f = fileEntries[i]!;
      const qs = new URLSearchParams({
        filename: f.filename,
        subfolder: f.subfolder ?? '',
        type: f.type ?? 'output',
      });
      const buf = await this.http.request<Buffer>(
        `${baseUrl}/view?${qs.toString()}`,
        {
          method: 'GET',
          headers,
          responseType: 'buffer',
          timeoutMs: 60_000,
          signal: ctx.signal,
        },
      );
      const ext = f.filename.split('.').pop()?.toLowerCase() ?? 'png';
      outputs.push({
        kind: 'buffer',
        data: buf,
        mimeType: mimeForExtension(ext),
        fileName: f.filename,
        role: AssetFileRole.PRIMARY,
        batchIndex: i,
      });
    }

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
    const wsClient = this.clients.get(ctx.job.id);
    wsClient?.close();
    this.clients.delete(ctx.job.id);

    const baseUrl = (
      ctx.provider.baseUrl || 'http://127.0.0.1:8188'
    ).replace(/\/$/, '');
    const headers = this.authHeaders(ctx.provider, 'none');
    const promptId = String(handle['promptId'] ?? ctx.job.externalJobId ?? '');

    try {
      await this.http.request(`${baseUrl}/interrupt`, {
        method: 'POST',
        headers,
        timeoutMs: 5_000,
        retries: 0,
      });
      if (promptId) {
        await this.http.request(`${baseUrl}/queue`, {
          method: 'POST',
          headers,
          body: { delete: [promptId] },
          timeoutMs: 5_000,
          retries: 0,
        });
      }
    } catch {
      // Best-effort cancel
    }
  }
}
