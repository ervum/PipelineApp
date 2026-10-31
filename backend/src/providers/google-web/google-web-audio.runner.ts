import {
  ErrorCode,
  findGoogleWebModel,
  GOOGLE_WEB_MODEL_CATALOG,
  GoogleWebModelDefinition,
  GoogleWebRunSettings,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { GoogleWebBrowserService } from './google-web-browser.service';
import {
  attachFilesToPage,
  configureAiStudioRunSettings,
  submitPromptInPage,
  TempAttachment,
} from './google-web-dom.helpers';

export interface GoogleWebAudioRunInput {
  modelId: string;
  prompt: string;
  attachments?: TempAttachment[];
  runSettings?: GoogleWebRunSettings;
  headless?: boolean;
  providerConfigId?: string;
  projectId?: string;
  jobId?: string;
  modality?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number, stage: string) => void;
}

@Injectable()
export class GoogleWebAudioRunner {
  constructor(private readonly browserService: GoogleWebBrowserService) {}

  resolveAudioModel(modelId: string): GoogleWebModelDefinition {
    const found = findGoogleWebModel(modelId);
    if (
      found &&
      (found.category === 'tts' ||
        found.category === 'audio_live' ||
        found.category === 'music')
    ) {
      return found;
    }
    return (
      GOOGLE_WEB_MODEL_CATALOG.find(
        (m) =>
          m.category === 'tts' ||
          m.category === 'audio_live' ||
          m.category === 'music',
      ) ?? GOOGLE_WEB_MODEL_CATALOG[0]!
    );
  }

  async runAudioGeneration(
    input: GoogleWebAudioRunInput,
  ): Promise<{ buffer: Buffer; mimeType: string; chatUrl: string }> {
    const model = this.resolveAudioModel(input.modelId);
    const trackingKey = input.jobId ?? `aud-${Date.now()}`;

    input.onProgress?.(10, 'Initializing browser...');
    const page = await this.browserService.openPageWithRecovery({
      headless: input.headless,
      trackingKey,
    });

    try {
      input.onProgress?.(22, `Opening AI Studio (${model.label})...`);
      await page.goto(model.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForTimeout(1400);

      input.onProgress?.(35, 'Configuring audio / music run settings...');
      await configureAiStudioRunSettings(page, model, input.runSettings);

      if (input.attachments && input.attachments.length > 0) {
        input.onProgress?.(45, 'Uploading reference audio...');
        await attachFilesToPage(page, input.attachments);
      }

      input.onProgress?.(55, `Submitting prompt & synthesizing ${model.category === 'music' ? 'music' : 'audio'}...`);
      await submitPromptInPage(page, 'aistudio', input.prompt);

      const maxWaitMs = 240_000;
      const startedWait = Date.now();
      let audioPayload: { b64: string; mimeType: string } | null = null;

      while (Date.now() - startedWait < maxWaitMs) {
        if (input.signal?.aborted) {
          throw new DomainError(
            ErrorCode.PROVIDER_ERROR,
            499,
            'Browser audio generation aborted',
          );
        }

        await page.waitForTimeout(1500);

        const elapsedSec = Math.round((Date.now() - startedWait) / 1000);
        input.onProgress?.(
          Math.min(90, 55 + Math.floor(elapsedSec / 2)),
          `Synthesizing ${model.label} (${elapsedSec}s)...`,
        );

        const result = await page.evaluate(async () => {
          const doc = (globalThis as unknown as {
            document: {
              querySelectorAll: (sel: string) => ArrayLike<{
                currentSrc?: string;
                src?: string;
                querySelector?: (s: string) => { src?: string } | null;
              }>;
            };
          }).document;
          const audios = Array.from(doc.querySelectorAll('audio'));
          for (const aud of audios.reverse()) {
            const src =
              aud.currentSrc ||
              aud.src ||
              aud.querySelector?.('source')?.src ||
              '';
            if (!src) continue;
            try {
              const res = await fetch(src);
              if (!res.ok) continue;
              const ab = await res.arrayBuffer();
              if (ab.byteLength < 256) continue;
              const mimeType =
                res.headers.get('content-type') || 'audio/wav';
              const bytes = new Uint8Array(ab);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]!);
              }
              return { b64: btoa(binary), mimeType };
            } catch {
              // Try next audio element
            }
          }
          return null;
        });

        if (result) {
          audioPayload = result;
          break;
        }
      }

      const chatUrl = page.url();
      await this.browserService.recordTrackedChat({
        providerConfigId: input.providerConfigId,
        projectId: input.projectId,
        jobId: input.jobId,
        role: 'GENERATOR',
        modality: input.modality ?? 'VOICES',
        platform: 'aistudio',
        modelId: model.id,
        chatUrl,
        chatTitle: input.prompt.slice(0, 80),
      });

      if (!audioPayload) {
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          `No audio output was produced by ${model.label} (${chatUrl})`,
        );
      }

      input.onProgress?.(95, 'Extracting generated audio...');
      return {
        buffer: Buffer.from(audioPayload.b64, 'base64'),
        mimeType: audioPayload.mimeType.includes('mp3')
          ? 'audio/mpeg'
          : 'audio/wav',
        chatUrl,
      };
    } finally {
      this.browserService.releasePage(trackingKey, page, true);
    }
  }
}
