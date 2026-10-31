import {
  ErrorCode,
  GENERATION_SUB_MODES,
  GenerationSubMode,
  interpolateTemplate,
  MODALITIES,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';
import { HttpClientService } from '../../../common/http/http-client.service';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import {
  GeneratorDispatchContext,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';
import { extractMappedOutputs } from '../runpod/runpod-serverless.adapter';

@Injectable()
export class GenericHttpAdapter extends BaseGeneratorAdapter {
  readonly id = 'generic-http';
  readonly providerKind = ProviderKind.GENERIC_HTTP;
  readonly modalities: readonly Modality[] = MODALITIES;
  readonly subModes: readonly GenerationSubMode[] = GENERATION_SUB_MODES;
  readonly tier = 'ANY' as const;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const baseUrl = (ctx.provider.baseUrl || '').replace(/\/$/, '');
    if (!baseUrl) {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        `Generic HTTP provider "${ctx.provider.name}" is missing baseUrl`,
      );
    }

    const template = ctx.provider.payloadTemplate;
    if (!template || typeof template !== 'object') {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        `Generic HTTP provider "${ctx.provider.name}" is missing payloadTemplate`,
      );
    }

    const mapping = ctx.provider.outputMapping;
    if (
      !mapping ||
      !Array.isArray(mapping.assets) ||
      mapping.assets.length === 0
    ) {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        `Generic HTTP provider "${ctx.provider.name}" is missing outputMapping.assets`,
      );
    }

    const dims = this.sizeFor(ctx.params);
    const ref0 = ctx.references[0];
    const refB64 = ref0 ? await ref0.base64() : null;
    const refDataUri = ref0 ? await ref0.dataUri() : null;

    const vars: Record<string, unknown> = {
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
      batch_count:
        'batchCount' in ctx.params && typeof ctx.params.batchCount === 'number'
          ? ctx.params.batchCount
          : 1,
      duration_seconds:
        'durationSec' in ctx.params &&
        typeof ctx.params.durationSec === 'number'
          ? ctx.params.durationSec
          : 10,
      reference_image_b64: refB64,
      reference_image_url: ref0?.publicUrl ?? null,
      reference_image_data_uri: refDataUri,
      voice_id: ctx.voiceProfile?.externalVoiceId ?? 'default',
      transcript: ctx.compiled.enhancedPrompt,
      speed:
        ctx.params.modality === Modality.VOICES
          ? ctx.params.speed
          : this.num(ctx.mergedParams, 'speed', 1.0),
      model: this.pickModel(ctx, 'default'),
      job_id: ctx.job.id,
      project_slug: ctx.project.slug,
      params: ctx.mergedParams,
    };

    const interpolated = interpolateTemplate(template, vars);
    const rawPath = (
      ctx.provider.settings as unknown as Record<string, unknown>
    )['path'];
    const suffixPath =
      typeof rawPath === 'string' && rawPath.length > 0
        ? rawPath.startsWith('/')
          ? rawPath
          : `/${rawPath}`
        : '';

    const headers: Record<string, string> = {
      ...ctx.provider.extraHeaders,
      ...(ctx.provider.secret
        ? { Authorization: `Bearer ${ctx.provider.secret}` }
        : {}),
    };

    const responseObj = await this.http.request<unknown>(
      `${baseUrl}${suffixPath}`,
      {
        method: 'POST',
        headers,
        body: interpolated.value as Record<string, unknown>,
        timeoutMs: ctx.provider.settings.timeoutMs,
        signal: ctx.signal,
      },
    );

    const outputs = extractMappedOutputs(responseObj, mapping);
    if (outputs.length === 0) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'Generic HTTP outputMapping matched zero assets in response',
      );
    }

    return {
      mode: 'sync',
      outputs,
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
