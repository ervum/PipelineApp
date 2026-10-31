import {
  AssetFileRole,
  ErrorCode,
  ExecutionTier,
  GENERATION_SUB_MODES,
  GenerationSubMode,
  interpolateTemplate,
  MODALITIES,
  Modality,
  OutputMapping,
  ProviderKind,
  selectPath,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';
import { extensionForMime } from '../../../common/utils/mime';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import {
  GeneratorDispatchContext,
  GeneratorOutput,
  GeneratorPollResult,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';
import {
  RunPodClient,
  RunPodStatusResponse,
  RunPodWorkersHealth,
} from './runpod-client';

const OPTIONAL_REFERENCE_VARS = new Set([
  'reference_image_b64',
  'reference_image_url',
  'reference_image_data_uri',
  'params.ref_audio_url',
]);

const HEALTH_CACHE_TTL_MS = 5_000;

interface CachedHealthEntry {
  at: number;
  workers: RunPodWorkersHealth;
}

export function extractMappedOutputs(
  responseObj: unknown,
  outputMapping: OutputMapping,
): GeneratorOutput[] {
  const outputs: GeneratorOutput[] = [];

  for (const spec of outputMapping.assets) {
    const normalizedPath = spec.path.replace(/^\$\.?/, '');
    const selected = selectPath(responseObj, normalizedPath);
    const role = (spec.role as AssetFileRole | undefined) ?? AssetFileRole.PRIMARY;
    const defaultMime = spec.mimeType || 'application/octet-stream';

    for (let idx = 0; idx < selected.length; idx++) {
      const rawVal = selected[idx];
      if (typeof rawVal !== 'string' || rawVal.length === 0) {
        continue;
      }

      if (spec.encoding === 'data_uri') {
        const match = /^data:([^;,]+);base64,([\s\S]+)$/i.exec(rawVal.trim());
        const mime = match?.[1] || defaultMime;
        const b64 = match?.[2] || rawVal.replace(/^data:[^,]+,/, '');
        const ext = extensionForMime(mime);
        outputs.push({
          kind: 'base64',
          data: b64,
          mimeType: mime,
          fileName: `output_${idx + 1}.${ext}`,
          role,
          batchIndex: idx,
        });
      } else if (spec.encoding === 'base64') {
        const cleanB64 = rawVal.replace(/^data:[^,]+,/, '').trim();
        const ext = extensionForMime(defaultMime);
        outputs.push({
          kind: 'base64',
          data: cleanB64,
          mimeType: defaultMime,
          fileName: `output_${idx + 1}.${ext}`,
          role,
          batchIndex: idx,
        });
      } else if (spec.encoding === 'url') {
        const ext = extensionForMime(defaultMime);
        outputs.push({
          kind: 'url',
          data: rawVal.trim(),
          mimeType: defaultMime,
          fileName: `output_${idx + 1}.${ext}`,
          role,
          batchIndex: idx,
        });
      } else if (spec.encoding === 'text') {
        const ext = extensionForMime(defaultMime);
        outputs.push({
          kind: 'text',
          data: rawVal,
          mimeType: defaultMime,
          fileName: `output_${idx + 1}.${ext}`,
          role,
          batchIndex: idx,
        });
      }
    }
  }

  return outputs;
}

@Injectable()
export class RunPodServerlessAdapter extends BaseGeneratorAdapter {
  readonly id = 'runpod-serverless';
  readonly providerKind = ProviderKind.RUNPOD_SERVERLESS;
  readonly modalities: readonly Modality[] = MODALITIES;
  readonly subModes: readonly GenerationSubMode[] = GENERATION_SUB_MODES;
  readonly tier = ExecutionTier.RUNPOD;

  private readonly healthCache = new Map<string, CachedHealthEntry>();

  constructor(private readonly client: RunPodClient) {
    super();
  }

  async buildTemplateVariables(
    ctx: GeneratorDispatchContext,
    template: unknown,
  ): Promise<Record<string, unknown>> {
    const dims = this.sizeFor(ctx.params);
    const batchCount =
      'batchCount' in ctx.params && typeof ctx.params.batchCount === 'number'
        ? Math.max(1, ctx.params.batchCount)
        : 'variationCount' in ctx.params &&
            typeof ctx.params.variationCount === 'number'
          ? Math.max(1, ctx.params.variationCount)
          : 1;

    const durationSeconds =
      ctx.params.modality === Modality.MUSIC
        ? ctx.params.durationSec
        : ctx.params.modality === Modality.SFX
          ? ctx.params.durationSec
          : this.num(ctx.mergedParams, 'duration_seconds', 10);

    const bpm =
      ctx.params.modality === Modality.MUSIC
        ? ctx.params.bpm
        : this.num(ctx.mergedParams, 'bpm', 110);

    const keySignature =
      ctx.params.modality === Modality.MUSIC
        ? ctx.params.keySignature
        : this.str(ctx.mergedParams, 'key_signature', 'C minor');

    const loop =
      ctx.params.modality === Modality.MUSIC
        ? ctx.params.seamlessLoop
        : ctx.params.modality === Modality.SFX
          ? ctx.params.loopable
          : this.bool(ctx.mergedParams, 'loop', false);

    const speed =
      ctx.params.modality === Modality.VOICES
        ? ctx.params.speed
        : this.num(ctx.mergedParams, 'speed', 1.0);

    const stability = this.num(
      ctx.mergedParams,
      'stability',
      ctx.params.modality === Modality.VOICES ? ctx.params.stability : 0.5,
    );

    const targetPolycount = Math.round(
      this.num(ctx.mergedParams, 'target_polycount', 8000),
    );
    const textureResolution = this.str(
      ctx.mergedParams,
      'texture_resolution',
      '2048',
    );

    const outputFormat =
      'outputFormat' in ctx.params &&
      typeof ctx.params.outputFormat === 'string'
        ? ctx.params.outputFormat
        : 'png';

    const baseVars: Record<string, unknown> = {
      enhanced_prompt: ctx.compiled.enhancedPrompt,
      negative_prompt: ctx.compiled.negativePrompt,
      raw_prompt: ctx.job.rawPrompt,
      seed: ctx.seed,
      width: dims.width,
      height: dims.height,
      aspect_ratio: dims.aspectRatio,
      steps: Math.round(this.num(ctx.mergedParams, 'steps', 28)),
      cfg_scale: this.num(
        ctx.mergedParams,
        'cfg_scale',
        this.num(ctx.mergedParams, 'guidance_scale', 7.0),
      ),
      batch_count: batchCount,
      duration_seconds: durationSeconds,
      bpm,
      key_signature: keySignature,
      loop,
      reference_image_b64: null,
      reference_image_url: ctx.references[0]?.publicUrl ?? null,
      reference_image_data_uri: null,
      voice_id: ctx.voiceProfile?.externalVoiceId ?? 'default',
      transcript: ctx.compiled.enhancedPrompt,
      speed,
      stability,
      target_polycount: targetPolycount,
      texture_resolution: textureResolution,
      output_format: outputFormat,
      model: this.pickModel(ctx, 'default'),
      job_id: ctx.job.id,
      project_slug: ctx.project.slug,
      params: ctx.mergedParams,
    };

    // Dry-run interpolation to inspect whether lazy reference_image_b64 or reference_image_data_uri is used
    const dryRun = interpolateTemplate(template, baseVars);
    const ref0 = ctx.references[0];
    if (ref0) {
      if (dryRun.used.includes('reference_image_b64')) {
        baseVars['reference_image_b64'] = await ref0.base64();
      }
      if (dryRun.used.includes('reference_image_data_uri')) {
        baseVars['reference_image_data_uri'] = await ref0.dataUri();
      }
    }

    return baseVars;
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const apiKey = this.requireSecret(ctx.provider);
    const endpointId = ctx.provider.runpodEndpointId;
    if (!endpointId || endpointId.trim().length === 0) {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        `RunPod provider "${ctx.provider.name}" is missing runpodEndpointId`,
      );
    }

    const template = ctx.provider.payloadTemplate;
    if (!template || typeof template !== 'object') {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        `RunPod provider "${ctx.provider.name}" is missing payloadTemplate`,
      );
    }

    const vars = await this.buildTemplateVariables(ctx, template);
    const interpolated = interpolateTemplate(template, vars);

    const requiredMissing = interpolated.missing.filter(
      (key) => !OPTIONAL_REFERENCE_VARS.has(key),
    );
    if (requiredMissing.length > 0) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        `RunPod template interpolation missing required variables: ${requiredMissing.join(', ')}`,
        { missing: requiredMissing },
      );
    }

    const rawInterpolated = interpolated.value;
    const hasRootInput =
      typeof rawInterpolated === 'object' &&
      rawInterpolated !== null &&
      !Array.isArray(rawInterpolated) &&
      Object.prototype.hasOwnProperty.call(rawInterpolated, 'input');

    const inputPayload = hasRootInput
      ? (rawInterpolated as Record<string, unknown>)['input']
      : rawInterpolated;

    // Non-fatal health check to detect warm vs cold-start
    const workers = await this.fetchWorkersHealth(
      endpointId,
      apiKey,
      ctx,
      true,
    );
    const warm = workers
      ? (workers.idle ?? 0) + (workers.running ?? 0) > 0
      : false;

    const runRes = await this.client.run(
      endpointId,
      apiKey,
      {
        input: inputPayload,
        ...(ctx.webhookUrl ? { webhook: ctx.webhookUrl } : {}),
        policy: {
          executionTimeout: ctx.provider.settings.executionTimeoutMs,
          ttl: ctx.provider.settings.ttlMs,
        },
      },
      {
        baseUrl: ctx.provider.baseUrl,
        extraHeaders: ctx.provider.extraHeaders,
        timeoutMs: ctx.provider.settings.timeoutMs,
        signal: ctx.signal,
      },
    );

    if (!runRes.id) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'RunPod /run response missing job id',
      );
    }

    const submittedAt = Date.now();
    ctx.reportWorker({
      externalJobId: runRes.id,
      externalStatus: runRes.status || 'IN_QUEUE',
      phase: warm ? 'WARM' : 'COLD_START',
      coldStart: !warm,
      queueDelayMs: null,
      workers,
    });

    return {
      mode: 'async',
      externalJobId: runRes.id,
      handle: {
        endpointId,
        submittedAt,
        warmAtSubmit: warm,
      },
      initialStatus: warm ? 'RUNNING' : 'COLD_START',
      pollAfterMs: ctx.provider.settings.pollIntervalMs,
    };
  }

  override async poll(
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
  ): Promise<GeneratorPollResult> {
    const apiKey = this.requireSecret(ctx.provider);
    const endpointId = String(
      handle['endpointId'] ?? ctx.provider.runpodEndpointId ?? '',
    );
    const externalId = String(ctx.job.externalJobId ?? '');

    const statusRes = await this.client.status(endpointId, apiKey, externalId, {
      baseUrl: ctx.provider.baseUrl,
      extraHeaders: ctx.provider.extraHeaders,
      timeoutMs: 25_000,
      signal: ctx.signal,
    });

    return this.evaluateStatusResponse(ctx, handle, statusRes, endpointId, apiKey);
  }

  async evaluateStatusResponse(
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
    statusRes: RunPodStatusResponse,
    endpointId?: string,
    apiKey?: string,
  ): Promise<GeneratorPollResult> {
    const submittedAt = Number(handle['submittedAt'] ?? Date.now());
    const warmAtSubmit = Boolean(handle['warmAtSubmit'] ?? false);
    const pollCount = ctx.job.pollCount ?? 0;

    const baseInterval = ctx.provider.settings.pollIntervalMs;
    const maxInterval = ctx.provider.settings.maxPollIntervalMs;
    const nextBackoff = Math.min(
      maxInterval,
      Math.round(baseInterval * Math.pow(1.5, pollCount / 4)),
    );

    if (statusRes.status === 'IN_QUEUE') {
      const workers =
        endpointId && apiKey
          ? await this.fetchWorkersHealth(endpointId, apiKey, ctx, false)
          : null;
      const coldStart = workers
        ? (workers.running === 0 && workers.initializing > 0) || !warmAtSubmit
        : !warmAtSubmit;
      const pollAfterMs = coldStart ? Math.max(nextBackoff, 3000) : nextBackoff;

      ctx.reportWorker({
        externalJobId: statusRes.id,
        externalStatus: 'IN_QUEUE',
        phase: coldStart ? 'COLD_START' : 'IN_QUEUE',
        coldStart,
        queueDelayMs: statusRes.delayTime ?? Date.now() - submittedAt,
        workers,
      });

      return {
        state: 'pending',
        coldStart,
        externalStatus: 'IN_QUEUE',
        progress: 5,
        pollAfterMs,
        queueDelayMs: statusRes.delayTime,
      };
    }

    if (statusRes.status === 'IN_PROGRESS') {
      const mapping = ctx.provider.outputMapping;
      let progress: number | undefined;
      if (mapping?.progressPath && statusRes.output !== undefined) {
        const selected = selectPath(
          statusRes,
          mapping.progressPath.replace(/^\$\.?/, ''),
        );
        const val = selected[0];
        if (typeof val === 'number' && Number.isFinite(val)) {
          progress = Math.max(0, Math.min(99, Math.round(val)));
        }
      }
      if (progress === undefined) {
        const elapsed = Math.max(0, Date.now() - submittedAt);
        progress = Math.min(
          90,
          Math.max(
            10,
            Math.round((elapsed / ctx.provider.settings.timeoutMs) * 100),
          ),
        );
      }

      ctx.reportWorker({
        externalJobId: statusRes.id,
        externalStatus: 'IN_PROGRESS',
        phase: 'RUNNING',
        coldStart: false,
        queueDelayMs: statusRes.delayTime ?? null,
        workers: null,
      });

      return {
        state: 'pending',
        coldStart: false,
        externalStatus: 'IN_PROGRESS',
        progress,
        pollAfterMs: nextBackoff,
        queueDelayMs: statusRes.delayTime,
      };
    }

    if (statusRes.status === 'TIMED_OUT') {
      return {
        state: 'failed',
        externalStatus: 'TIMED_OUT',
        code: ErrorCode.PROVIDER_TIMEOUT,
        message: statusRes.error || 'RunPod job timed out',
        retryable: true,
      };
    }

    if (statusRes.status === 'CANCELLED') {
      return {
        state: 'failed',
        externalStatus: 'CANCELLED',
        code: ErrorCode.PROVIDER_ERROR,
        message: 'Cancelled at provider',
        retryable: false,
      };
    }

    if (statusRes.status === 'FAILED') {
      const mapping = ctx.provider.outputMapping;
      let errMsg = statusRes.error;
      if (!errMsg && mapping?.errorPath) {
        const selected = selectPath(
          statusRes,
          mapping.errorPath.replace(/^\$\.?/, ''),
        );
        if (typeof selected[0] === 'string' && selected[0].length > 0) {
          errMsg = selected[0];
        }
      }
      return {
        state: 'failed',
        externalStatus: 'FAILED',
        code: ErrorCode.PROVIDER_ERROR,
        message: errMsg || 'RunPod execution failed',
        retryable: false,
      };
    }

    // COMPLETED
    const mapping = ctx.provider.outputMapping;
    if (!mapping || !Array.isArray(mapping.assets) || mapping.assets.length === 0) {
      return {
        state: 'failed',
        externalStatus: 'COMPLETED',
        code: ErrorCode.PROVIDER_NOT_CONFIGURED,
        message: 'RunPod provider is missing outputMapping.assets configuration',
        retryable: false,
      };
    }

    const outputs = extractMappedOutputs(statusRes, mapping);
    if (outputs.length === 0) {
      const topKeys =
        typeof statusRes.output === 'object' && statusRes.output !== null
          ? Object.keys(statusRes.output as Record<string, unknown>).join(', ')
          : typeof statusRes.output;
      return {
        state: 'failed',
        externalStatus: 'COMPLETED',
        code: ErrorCode.PROVIDER_ERROR,
        message: `Output mapping matched nothing (output keys: ${topKeys || 'none'})`,
        retryable: false,
      };
    }

    const executionMs = statusRes.executionTime;
    const queueDelayMs = statusRes.delayTime;
    const costPerSec = ctx.provider.settings.costPerSecondUsd ?? 0;
    const costPerReq = ctx.provider.settings.costPerRequestUsd ?? 0;
    const costUsd =
      typeof executionMs === 'number'
        ? Number(((executionMs / 1000) * costPerSec + costPerReq).toFixed(6))
        : costPerReq > 0
          ? costPerReq
          : undefined;

    ctx.reportWorker({
      externalJobId: statusRes.id,
      externalStatus: 'COMPLETED',
      phase: 'DONE',
      coldStart: false,
      queueDelayMs: queueDelayMs ?? null,
      workers: null,
    });

    return {
      state: 'completed',
      outputs,
      externalStatus: 'COMPLETED',
      costUsd,
      executionMs,
      queueDelayMs,
    };
  }

  override async cancel(
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
  ): Promise<void> {
    const apiKey = ctx.provider.secret;
    const endpointId = String(
      handle['endpointId'] ?? ctx.provider.runpodEndpointId ?? '',
    );
    const externalId = String(ctx.job.externalJobId ?? '');
    if (!apiKey || !endpointId || !externalId) {
      return;
    }
    try {
      await this.client.cancel(endpointId, apiKey, externalId, {
        baseUrl: ctx.provider.baseUrl,
        extraHeaders: ctx.provider.extraHeaders,
      });
    } catch {
      // Best-effort cancel
    }
  }

  private async fetchWorkersHealth(
    endpointId: string,
    apiKey: string,
    ctx: GeneratorDispatchContext,
    bypassCache: boolean,
  ): Promise<RunPodWorkersHealth | null> {
    const now = Date.now();
    const cached = this.healthCache.get(endpointId);
    if (!bypassCache && cached && now - cached.at < HEALTH_CACHE_TTL_MS) {
      return cached.workers;
    }

    try {
      const h = await this.client.health(endpointId, apiKey, {
        baseUrl: ctx.provider.baseUrl,
        extraHeaders: ctx.provider.extraHeaders,
        signal: ctx.signal,
      });
      if (!h.workers) {
        return null;
      }
      const workers: RunPodWorkersHealth = {
        idle: h.workers.idle ?? 0,
        running: h.workers.running ?? 0,
        initializing: h.workers.initializing ?? 0,
        throttled: h.workers.throttled ?? 0,
      };
      this.healthCache.set(endpointId, { at: now, workers });
      return workers;
    } catch {
      return null;
    }
  }
}
