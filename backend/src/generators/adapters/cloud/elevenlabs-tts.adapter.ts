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

interface ElevenLabsWithTimestampsResponse {
  audio_base64?: string;
  alignment?: {
    characters?: string[];
    character_start_times_seconds?: number[];
    character_end_times_seconds?: number[];
  };
}

@Injectable()
export class ElevenLabsTtsAdapter extends BaseGeneratorAdapter {
  readonly id = 'elevenlabs-tts';
  readonly providerKind = ProviderKind.ELEVENLABS;
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
        'ElevenLabs TTS requires a VoiceProfile with externalVoiceId',
      );
    }

    const baseUrl = (
      ctx.provider.baseUrl || 'https://api.elevenlabs.io'
    ).replace(/\/$/, '');
    const headers = this.authHeaders(ctx.provider, 'xi-api-key');
    const modelId = this.pickModel(ctx, 'eleven_multilingual_v2');

    const voiceParams =
      ctx.params.modality === Modality.VOICES ? ctx.params : null;
    const outputFormat =
      voiceParams?.outputFormat === 'mp3' ? 'mp3_44100_128' : 'pcm_44100';

    const defaultSettings =
      ctx.voiceProfile &&
      typeof ctx.voiceProfile.defaultSettings === 'object' &&
      ctx.voiceProfile.defaultSettings !== null
        ? (ctx.voiceProfile.defaultSettings as Record<string, unknown>)
        : {};

    const stability = this.num(
      ctx.mergedParams,
      'stability',
      voiceParams?.stability ??
        (typeof defaultSettings['stability'] === 'number'
          ? defaultSettings['stability']
          : 0.5),
    );
    const similarityBoost = this.num(
      ctx.mergedParams,
      'similarity_boost',
      voiceParams?.similarityBoost ??
        (typeof defaultSettings['similarityBoost'] === 'number'
          ? defaultSettings['similarityBoost']
          : 0.75),
    );
    const style = this.num(
      ctx.mergedParams,
      'style',
      voiceParams?.style ??
        (typeof defaultSettings['styleExaggeration'] === 'number'
          ? defaultSettings['styleExaggeration']
          : 0.35),
    );
    const speed =
      voiceParams?.speed ?? this.num(ctx.mergedParams, 'speed', 1.0);

    const res = await this.http.request<ElevenLabsWithTimestampsResponse>(
      `${baseUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps?output_format=${outputFormat}`,
      {
        method: 'POST',
        headers,
        body: {
          text: ctx.compiled.enhancedPrompt,
          model_id: modelId,
          seed: ctx.seed,
          voice_settings: {
            stability,
            similarity_boost: similarityBoost,
            style,
            use_speaker_boost: true,
            speed,
          },
        },
        timeoutMs: ctx.provider.settings.timeoutMs,
        signal: ctx.signal,
      },
    );

    if (!res.audio_base64) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'ElevenLabs TTS returned no audio_base64',
      );
    }

    const isPcm = outputFormat === 'pcm_44100';

    return {
      mode: 'sync',
      outputs: [
        {
          kind: 'base64',
          data: res.audio_base64,
          mimeType: isPcm ? 'audio/pcm' : 'audio/mpeg',
          fileName: isPcm ? 'voice.wav' : 'voice.mp3',
          role: AssetFileRole.PRIMARY,
          batchIndex: 0,
          metadata: {
            pcmSampleRate: isPcm ? 44100 : undefined,
            characterAlignment: res.alignment ?? null,
          },
        },
      ],
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
