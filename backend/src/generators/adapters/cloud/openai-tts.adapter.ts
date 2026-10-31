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
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

@Injectable()
export class OpenAiTtsAdapter extends BaseGeneratorAdapter {
  readonly id = 'openai-tts';
  readonly providerKind = ProviderKind.OPENAI;
  readonly modalities = [Modality.VOICES] as const;
  readonly subModes = [GenerationSubMode.STANDARD] as const;
  readonly tier = ExecutionTier.CLOUD_API;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const baseUrl = (ctx.provider.baseUrl || 'https://api.openai.com').replace(
      /\/$/,
      '',
    );
    const headers = this.authHeaders(ctx.provider, 'Bearer');
    const model = this.pickModel(ctx, 'gpt-4o-mini-tts');

    const voiceParams =
      ctx.params.modality === Modality.VOICES ? ctx.params : null;
    const responseFormat = voiceParams?.outputFormat === 'mp3' ? 'mp3' : 'wav';
    const mimeType = responseFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    const speed =
      voiceParams?.speed ?? this.num(ctx.mergedParams, 'speed', 1.0);
    const voice = ctx.voiceProfile?.externalVoiceId || 'alloy';
    const instructions = this.str(
      ctx.mergedParams,
      'instructions',
      ctx.voiceProfile?.description ||
        'Natural in-character delivery with clear articulation.',
    );

    const buffer = await this.http.request<Buffer>(
      `${baseUrl}/v1/audio/speech`,
      {
        method: 'POST',
        headers,
        body: {
          model,
          voice,
          input: ctx.compiled.enhancedPrompt,
          instructions,
          response_format: responseFormat,
          speed,
        },
        responseType: 'buffer',
        timeoutMs: ctx.provider.settings.timeoutMs,
        signal: ctx.signal,
      },
    );

    return {
      mode: 'sync',
      outputs: [
        {
          kind: 'buffer',
          data: buffer,
          mimeType,
          fileName: `voice.${responseFormat}`,
          role: AssetFileRole.PRIMARY,
          batchIndex: 0,
        },
      ],
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
