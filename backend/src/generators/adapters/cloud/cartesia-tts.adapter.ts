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
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

@Injectable()
export class CartesiaTtsAdapter extends BaseGeneratorAdapter {
  readonly id = 'cartesia-tts';
  readonly providerKind = ProviderKind.CARTESIA;
  readonly modalities = [Modality.VOICES] as const;
  readonly subModes = [GenerationSubMode.STANDARD] as const;
  readonly tier = ExecutionTier.CLOUD_API;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const voiceId = ctx.voiceProfile?.externalVoiceId;
    if (!voiceId || voiceId.trim().length === 0) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Cartesia TTS requires a VoiceProfile with externalVoiceId',
      );
    }

    const baseUrl = (
      ctx.provider.baseUrl || 'https://api.cartesia.ai'
    ).replace(/\/$/, '');
    const headers: Record<string, string> = {
      ...this.authHeaders(ctx.provider, 'X-API-Key'),
      'Cartesia-Version': '2025-04-16',
    };

    const modelId = this.pickModel(ctx, 'sonic-2');

    const buffer = await this.http.request<Buffer>(`${baseUrl}/tts/bytes`, {
      method: 'POST',
      headers,
      body: {
        model_id: modelId,
        transcript: ctx.compiled.enhancedPrompt,
        voice: {
          mode: 'id',
          id: voiceId,
        },
        output_format: {
          container: 'wav',
          encoding: 'pcm_s16le',
          sample_rate: 44100,
        },
        language: 'en',
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
          mimeType: 'audio/wav',
          fileName: 'voice.wav',
          role: AssetFileRole.PRIMARY,
          batchIndex: 0,
        },
      ],
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
