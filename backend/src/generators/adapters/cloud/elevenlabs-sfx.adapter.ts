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
export class ElevenLabsSfxAdapter extends BaseGeneratorAdapter {
  readonly id = 'elevenlabs-sfx';
  readonly providerKind = ProviderKind.ELEVENLABS;
  readonly modalities = [Modality.SFX] as const;
  readonly subModes = [GenerationSubMode.STANDARD] as const;
  readonly tier = ExecutionTier.CLOUD_API;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const baseUrl = (
      ctx.provider.baseUrl || 'https://api.elevenlabs.io'
    ).replace(/\/$/, '');
    const headers = this.authHeaders(ctx.provider, 'xi-api-key');

    const sfxParams = ctx.params.modality === Modality.SFX ? ctx.params : null;
    const durationSeconds = sfxParams?.durationSec ?? 3;
    const loopable = sfxParams?.loopable ?? false;
    const variationCount = Math.max(1, sfxParams?.variationCount ?? 1);
    const promptInfluence = this.num(
      ctx.mergedParams,
      'prompt_influence',
      0.65,
    );

    const indices = Array.from({ length: variationCount }, (_, idx) => idx);
    const outputs: GeneratorOutput[] = [];
    const maxConcurrent = 4;

    for (let offset = 0; offset < indices.length; offset += maxConcurrent) {
      const slice = indices.slice(offset, offset + maxConcurrent);
      const batchBuffers = await Promise.all(
        slice.map((idx) =>
          this.http.request<Buffer>(`${baseUrl}/v1/sound-generation`, {
            method: 'POST',
            headers,
            body: {
              text:
                variationCount > 1
                  ? `${ctx.compiled.enhancedPrompt} (variation ${idx + 1})`
                  : ctx.compiled.enhancedPrompt,
              duration_seconds: durationSeconds,
              prompt_influence: promptInfluence,
              loop: loopable,
            },
            responseType: 'buffer',
            timeoutMs: ctx.provider.settings.timeoutMs,
            signal: ctx.signal,
          }),
        ),
      );

      for (let j = 0; j < slice.length; j++) {
        const batchIdx = slice[j]!;
        outputs.push({
          kind: 'buffer',
          data: batchBuffers[j]!,
          mimeType: 'audio/mpeg',
          fileName: `sfx_${batchIdx + 1}.mp3`,
          role: AssetFileRole.PRIMARY,
          batchIndex: batchIdx,
        });
      }
    }

    return {
      mode: 'sync',
      outputs,
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
