import {
  AssetFileRole,
  ErrorCode,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { GoogleGenAI, Interactions } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import {
  GeneratorDispatchContext,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

@Injectable()
export class GeminiTtsAdapter extends BaseGeneratorAdapter {
  readonly id = 'gemini-tts';
  readonly providerKind = ProviderKind.GEMINI;
  readonly modalities = [Modality.VOICES] as const;
  readonly subModes = [GenerationSubMode.STANDARD] as const;
  readonly tier = ExecutionTier.CLOUD_API;

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const apiKey = this.requireSecret(ctx.provider);
    const ai = new GoogleGenAI({ apiKey });

    const rawModel = this.pickModel(ctx, 'gemini-3.8-flash-tts');
    const model =
      rawModel.startsWith('gemini-2.') || rawModel === 'gemini-3.8-flash'
        ? 'gemini-3.8-flash-tts'
        : rawModel;

    const voiceName = ctx.voiceProfile?.externalVoiceId || 'Kore';
    const styleInstructions = this.str(
      ctx.mergedParams,
      'instructions',
      ctx.voiceProfile?.description || '',
    );

    const voiceParams =
      ctx.params.modality === Modality.VOICES ? ctx.params : null;
    const isMp3 = voiceParams?.outputFormat === 'mp3';
    const responseMime: Interactions.AudioResponseFormat['mime_type'] = isMp3
      ? 'audio/mp3'
      : 'audio/wav';

    const textBlock: Interactions.TextContent = {
      type: 'text',
      text: ctx.compiled.enhancedPrompt,
      ...(styleInstructions
        ? {
            annotations: [
              {
                type: 'speech_metadata',
                style: styleInstructions,
              },
            ],
          }
        : {}),
    };

    const userStep: Interactions.UserInputStep = {
      type: 'user_input',
      content: [textBlock],
    };

    let interaction: Interactions.Interaction;
    try {
      interaction = await ai.interactions.create({
        model,
        input: [userStep],
        response_format: {
          type: 'audio',
          mime_type: responseMime,
        },
        generation_config: {
          speech_config: [{ voice: voiceName }],
        },
        store: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|403|api_key|unauthenticated/i.test(msg)) {
        throw new DomainError(
          ErrorCode.PROVIDER_AUTH_FAILED,
          502,
          `Gemini TTS auth failed: ${msg}`,
        );
      }
      if (/429|quota|rate/i.test(msg)) {
        throw new DomainError(
          ErrorCode.PROVIDER_RATE_LIMITED,
          429,
          `Gemini TTS rate limited: ${msg}`,
        );
      }
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        `Gemini TTS failed: ${msg}`,
      );
    }

    const audioBlock = interaction.output_audio;
    const base64Audio = audioBlock?.data;
    if (!base64Audio) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'Gemini TTS interaction returned no output_audio data',
      );
    }

    const ext = isMp3 ? 'mp3' : 'wav';
    const mimeType = isMp3 ? 'audio/mpeg' : 'audio/wav';

    return {
      mode: 'sync',
      outputs: [
        {
          kind: 'base64',
          data: base64Audio,
          mimeType,
          fileName: `voice.${ext}`,
          role: AssetFileRole.PRIMARY,
          batchIndex: 0,
        },
      ],
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
