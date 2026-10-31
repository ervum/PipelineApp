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
export class FishAudioTtsAdapter extends BaseGeneratorAdapter {
  readonly id = 'fish-audio-tts';
  readonly providerKind = ProviderKind.FISH_AUDIO;
  readonly modalities = [Modality.VOICES] as const;
  readonly subModes = [GenerationSubMode.STANDARD] as const;
  readonly tier = ExecutionTier.CLOUD_API;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const referenceId = ctx.voiceProfile?.externalVoiceId;
    if (!referenceId || referenceId.trim().length === 0) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Fish Audio TTS requires a VoiceProfile with externalVoiceId (reference_id)',
      );
    }

    const baseUrl = (
      ctx.provider.baseUrl || 'https://api.fish.audio'
    ).replace(/\/$/, '');
    const model = this.pickModel(ctx, 's1');
    const headers: Record<string, string> = {
      ...this.authHeaders(ctx.provider, 'Bearer'),
      model,
    };

    const voiceParams =
      ctx.params.modality === Modality.VOICES ? ctx.params : null;
    const format = voiceParams?.outputFormat === 'mp3' ? 'mp3' : 'wav';
    const mimeType = format === 'mp3' ? 'audio/mpeg' : 'audio/wav';

    const buffer = await this.http.request<Buffer>(`${baseUrl}/v1/tts`, {
      method: 'POST',
      headers,
      body: {
        text: ctx.compiled.enhancedPrompt,
        reference_id: referenceId,
        format,
        latency: 'normal',
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
          fileName: `voice.${format}`,
          role: AssetFileRole.PRIMARY,
          batchIndex: 0,
        },
      ],
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
