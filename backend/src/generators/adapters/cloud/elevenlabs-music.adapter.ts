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
export class ElevenLabsMusicAdapter extends BaseGeneratorAdapter {
  readonly id = 'elevenlabs-music';
  readonly providerKind = ProviderKind.ELEVENLABS;
  readonly modalities = [Modality.MUSIC] as const;
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

    const musicParams =
      ctx.params.modality === Modality.MUSIC ? ctx.params : null;
    const durationSec =
      musicParams?.durationSec ??
      this.num(ctx.mergedParams, 'duration_seconds', 30);
    const instrumentalOnly = musicParams?.instrumentalOnly ?? true;

    const buffer = await this.http.request<Buffer>(`${baseUrl}/v1/music`, {
      method: 'POST',
      headers,
      body: {
        prompt: ctx.compiled.enhancedPrompt,
        music_length_ms: Math.round(durationSec * 1000),
        force_instrumental: instrumentalOnly,
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
          mimeType: 'audio/mpeg',
          fileName: 'music.mp3',
          role: AssetFileRole.PRIMARY,
          batchIndex: 0,
        },
      ],
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
