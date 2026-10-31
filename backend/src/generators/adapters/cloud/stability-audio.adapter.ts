import {
  AssetFileRole,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { HttpClientService } from '../../../common/http/http-client.service';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import {
  GeneratorDispatchContext,
  GeneratorOutput,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

@Injectable()
export class StabilityAudioAdapter extends BaseGeneratorAdapter {
  readonly id = 'stability-audio';
  readonly providerKind = ProviderKind.STABILITY;
  readonly modalities = [Modality.MUSIC, Modality.SFX] as const;
  readonly subModes = [GenerationSubMode.STANDARD] as const;
  readonly tier = ExecutionTier.CLOUD_API;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const baseUrl = (
      ctx.provider.baseUrl || 'https://api.stability.ai'
    ).replace(/\/$/, '');
    const headers: Record<string, string> = {
      ...this.authHeaders(ctx.provider, 'Bearer'),
      Accept: 'audio/*',
    };

    const prompt = this.foldNegative(
      ctx.compiled.enhancedPrompt,
      ctx.compiled.negativePrompt,
    );

    const duration =
      ctx.params.modality === Modality.MUSIC
        ? ctx.params.durationSec
        : ctx.params.modality === Modality.SFX
          ? ctx.params.durationSec
          : this.num(ctx.mergedParams, 'duration_seconds', 10);

    const outputFormat =
      ctx.params.modality === Modality.MUSIC &&
      ctx.params.outputFormat === 'mp3'
        ? 'mp3'
        : 'wav';
    const mimeType = outputFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav';

    const variationCount =
      ctx.params.modality === Modality.SFX
        ? Math.max(1, ctx.params.variationCount)
        : 1;

    const steps = Math.round(this.num(ctx.mergedParams, 'steps', 50));
    const cfgScale = this.num(ctx.mergedParams, 'cfg_scale', 7);

    const outputs: GeneratorOutput[] = [];
    for (let i = 0; i < variationCount; i++) {
      const form = new FormData();
      form.append('prompt', prompt);
      form.append('duration', String(duration));
      form.append('seed', String((ctx.seed + i) % 2147483647));
      form.append('steps', String(steps));
      form.append('cfg_scale', String(cfgScale));
      form.append('output_format', outputFormat);

      const buffer = await this.http.request<Buffer>(
        `${baseUrl}/v2beta/audio/stable-audio-2/text-to-audio`,
        {
          method: 'POST',
          headers,
          body: form,
          responseType: 'buffer',
          timeoutMs: ctx.provider.settings.timeoutMs,
          signal: ctx.signal,
        },
      );

      outputs.push({
        kind: 'buffer',
        data: buffer,
        mimeType,
        fileName: `audio_${i + 1}.${outputFormat}`,
        role: AssetFileRole.PRIMARY,
        batchIndex: i,
      });
    }

    return {
      mode: 'sync',
      outputs,
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
