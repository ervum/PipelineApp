import {
  AssetFileRole,
  defaultGoogleWebRunSettingsForModel,
  ExecutionTier,
  GenerationSubMode,
  GoogleWebRunSettings,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { GoogleWebAudioRunner } from '../../../providers/google-web/google-web-audio.runner';
import { TempAttachment } from '../../../providers/google-web/google-web-dom.helpers';
import { GoogleWebImageRunner } from '../../../providers/google-web/google-web-image.runner';
import { GoogleWebVideoRunner } from '../../../providers/google-web/google-web-video.runner';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import {
  GeneratorDispatchContext,
  GeneratorOutput,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

@Injectable()
export class GoogleWebGeneratorAdapter extends BaseGeneratorAdapter {
  readonly id = 'cloud-google-web';
  readonly providerKind = ProviderKind.GOOGLE_WEB;
  readonly modalities = [
    Modality.ICONS_2D,
    Modality.IMAGES,
    Modality.VIDEO,
    Modality.VOICES,
    Modality.SFX,
    Modality.MUSIC,
    Modality.OTHER,
  ] as const;
  readonly subModes = [
    GenerationSubMode.STANDARD,
    GenerationSubMode.TEXT_TO_VIDEO,
    GenerationSubMode.IMAGE_TO_VIDEO,
    GenerationSubMode.SPRITESHEET,
    GenerationSubMode.VFX_TEXTURE,
  ] as const;
  readonly tier = ExecutionTier.CLOUD_API;

  constructor(
    private readonly imageRunner: GoogleWebImageRunner,
    private readonly videoRunner: GoogleWebVideoRunner,
    private readonly audioRunner: GoogleWebAudioRunner,
  ) {
    super();
  }

  private resolveDefaultModelForModality(ctx: GeneratorDispatchContext): string {
    const authMode = ctx.provider.settings.webAuthMode ?? 'aistudio';
    if (
      ctx.modality === Modality.ICONS_2D ||
      ctx.modality === Modality.IMAGES ||
      ctx.modality === Modality.OTHER
    ) {
      if (authMode === 'gemini_guest') {
        return 'gemini-web-guest-img:3.5-flash-lite';
      }
      if (authMode === 'gemini_auth') {
        return 'gemini-web-img:4.0-argon';
      }
      return 'aistudio-img:nano-banana-2.1';
    }
    if (ctx.modality === Modality.VIDEO) {
      if (authMode === 'gemini_auth') {
        return 'gemini-web-vid:4.0-argon';
      }
      return 'aistudio-vid:gemini-omni-1.1-flash';
    }
    if (ctx.modality === Modality.MUSIC) {
      return 'aistudio-music:lyria-3.5';
    }
    if (ctx.modality === Modality.SFX) {
      return 'aistudio-live:gemini-3.8-live';
    }
    return 'aistudio-tts:gemini-3.8-flash-tts';
  }

  private extractRunSettings(
    ctx: GeneratorDispatchContext,
    modelId: string,
  ): GoogleWebRunSettings {
    const defaults = defaultGoogleWebRunSettingsForModel(modelId);
    const paramSettings =
      'googleWebRunSettings' in ctx.params && ctx.params.googleWebRunSettings
        ? ctx.params.googleWebRunSettings
        : {};
    return {
      ...defaults,
      ...paramSettings,
    };
  }

  private async collectAttachments(
    ctx: GeneratorDispatchContext,
  ): Promise<TempAttachment[]> {
    const list: TempAttachment[] = [];
    for (let i = 0; i < ctx.references.length; i++) {
      const ref = ctx.references[i]!;
      const b64 = await ref.base64();
      const ext = ref.mimeType.includes('png')
        ? 'png'
        : ref.mimeType.includes('mp4')
          ? 'mp4'
          : ref.mimeType.includes('wav')
            ? 'wav'
            : 'jpg';
      list.push({
        buffer: Buffer.from(b64, 'base64'),
        mimeType: ref.mimeType,
        fileName: `ref_${i + 1}.${ext}`,
      });
    }
    return list;
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const fallbackModel = this.resolveDefaultModelForModality(ctx);
    const modelId = this.pickModel(ctx, fallbackModel);
    const runSettings = this.extractRunSettings(ctx, modelId);
    const headless = ctx.provider.settings.browserHeadless ?? true;
    const attachments = await this.collectAttachments(ctx);

    const onProgress = (percent: number, stage: string): void => {
      ctx.reportProgress({ percent, stage, message: stage });
    };

    const prompt = this.foldNegative(
      ctx.compiled.enhancedPrompt,
      ctx.compiled.negativePrompt,
    );

    if (
      ctx.modality === Modality.ICONS_2D ||
      ctx.modality === Modality.IMAGES ||
      ctx.modality === Modality.OTHER
    ) {
      const res = await this.imageRunner.runImageGeneration({
        modelId,
        prompt,
        attachments,
        runSettings,
        headless,
        providerConfigId: ctx.provider.id,
        projectId: ctx.project.id,
        jobId: ctx.job.id,
        modality: ctx.modality,
        signal: ctx.signal,
        onProgress,
      });

      const outputs: GeneratorOutput[] = res.images.map((img, idx) => ({
        kind: 'buffer',
        data: img.buffer,
        mimeType: img.mimeType,
        fileName: `google_web_image_${idx + 1}.png`,
        role: AssetFileRole.PRIMARY,
        batchIndex: idx,
        metadata: {
          modelId,
          chatUrl: res.chatUrl,
          ...(img.accompanyingText
            ? { accompanyingText: img.accompanyingText }
            : {}),
        },
      }));

      return {
        mode: 'sync',
        outputs,
        costUsd: 0,
        executionMs: Math.max(1, Date.now() - startedMs),
      };
    }

    if (ctx.modality === Modality.VIDEO) {
      const res = await this.videoRunner.runVideoGeneration({
        modelId,
        prompt,
        attachments,
        runSettings,
        headless,
        providerConfigId: ctx.provider.id,
        projectId: ctx.project.id,
        jobId: ctx.job.id,
        signal: ctx.signal,
        onProgress,
      });

      return {
        mode: 'sync',
        outputs: [
          {
            kind: 'buffer',
            data: res.buffer,
            mimeType: res.mimeType,
            fileName: 'google_web_video.mp4',
            role: AssetFileRole.PRIMARY,
            batchIndex: 0,
            metadata: {
              modelId,
              chatUrl: res.chatUrl,
              durationSec:
                runSettings.videoDurationSec ??
                (ctx.params.modality === Modality.VIDEO
                  ? ctx.params.durationSec
                  : 5),
              aspectRatio:
                runSettings.aspectRatio ??
                (ctx.params.modality === Modality.VIDEO
                  ? ctx.params.aspectRatio
                  : '16:9'),
              resolution:
                runSettings.resolution ??
                (ctx.params.modality === Modality.VIDEO
                  ? ctx.params.resolution
                  : '1080p'),
              fps: 24,
            },
          },
        ],
        costUsd: 0,
        executionMs: Math.max(1, Date.now() - startedMs),
      };
    }

    // VOICES, SFX, MUSIC
    const audioPrompt =
      ctx.params.modality === Modality.VOICES &&
      ctx.params.transcript.trim().length > 0
        ? ctx.params.transcript.trim()
        : prompt;

    const res = await this.audioRunner.runAudioGeneration({
      modelId,
      prompt: audioPrompt,
      attachments,
      runSettings,
      headless,
      providerConfigId: ctx.provider.id,
      projectId: ctx.project.id,
      jobId: ctx.job.id,
      modality: ctx.modality,
      signal: ctx.signal,
      onProgress,
    });

    const ext = res.mimeType.includes('mp3') || res.mimeType.includes('mpeg') ? 'mp3' : 'wav';
    return {
      mode: 'sync',
      outputs: [
        {
          kind: 'buffer',
          data: res.buffer,
          mimeType: res.mimeType,
          fileName: `google_web_audio.${ext}`,
          role: AssetFileRole.PRIMARY,
          batchIndex: 0,
          metadata: {
            modelId,
            chatUrl: res.chatUrl,
            ...(runSettings.liveVoice ? { voice: runSettings.liveVoice } : {}),
          },
        },
      ],
      costUsd: 0,
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
