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
export class OpenAiCompatibleTtsAdapter extends BaseGeneratorAdapter {
  readonly id = 'openai-compatible-tts';
  readonly providerKind = ProviderKind.OPENAI_COMPATIBLE;
  readonly modalities = [Modality.VOICES] as const;
  readonly subModes = [GenerationSubMode.STANDARD] as const;
  readonly tier = ExecutionTier.LOCAL;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const baseUrl = (
      ctx.provider.baseUrl || 'http://127.0.0.1:8880'
    ).replace(/\/$/, '');
    const headers: Record<string, string> = {
      ...ctx.provider.extraHeaders,
      ...(ctx.provider.secret
        ? { Authorization: `Bearer ${ctx.provider.secret}` }
        : {}),
    };

    const model = this.pickModel(ctx, 'kokoro');
    const voice = ctx.voiceProfile?.externalVoiceId || 'af_bella';
    const voiceParams =
      ctx.params.modality === Modality.VOICES ? ctx.params : null;
    const responseFormat = voiceParams?.outputFormat === 'mp3' ? 'mp3' : 'wav';
    const mimeType = responseFormat === 'mp3' ? 'audio/mpeg' : 'audio/wav';
    const speed =
      voiceParams?.speed ?? this.num(ctx.mergedParams, 'speed', 1.0);

    const speechEndpoint = baseUrl.endsWith('/v1')
      ? `${baseUrl}/audio/speech`
      : `${baseUrl}/v1/audio/speech`;

    const buffer = await this.http.request<Buffer>(speechEndpoint, {
      method: 'POST',
      headers,
      body: {
        model,
        voice,
        input: ctx.compiled.enhancedPrompt,
        response_format: responseFormat,
        speed,
      },
      responseType: 'buffer',
      timeoutMs: ctx.provider.settings.timeoutMs,
      signal: ctx.signal,
    });

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
