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
  configureGeminiWebControls,
  submitPromptInPage,
  TempAttachment,
} from './google-web-dom.helpers';

export interface GoogleWebVideoRunInput {
  modelId: string;
  prompt: string;
  attachments?: TempAttachment[];
  runSettings?: GoogleWebRunSettings;
  headless?: boolean;
  providerConfigId?: string;
  projectId?: string;
  jobId?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number, stage: string) => void;
}

@Injectable()
export class GoogleWebVideoRunner {
  constructor(private readonly browserService: GoogleWebBrowserService) {}

  resolveVideoModel(modelId: string): GoogleWebModelDefinition {
    const found = findGoogleWebModel(modelId);
    if (found && found.category === 'video') return found;
    return (
      GOOGLE_WEB_MODEL_CATALOG.find((m) => m.category === 'video') ??
      GOOGLE_WEB_MODEL_CATALOG[0]!
    );
  }

  async runVideoGeneration(
    input: GoogleWebVideoRunInput,
  ): Promise<{ buffer: Buffer; mimeType: string; chatUrl: string }> {
    const model = this.resolveVideoModel(input.modelId);
    const platform: 'gemini' | 'aistudio' =
      model.authMode === 'aistudio' ? 'aistudio' : 'gemini';
    const trackingKey = input.jobId ?? `vid-${Date.now()}`;

    input.onProgress?.(10, 'Initializing browser...');
    const page = await this.browserService.openPageWithRecovery({
      headless: input.headless,
      trackingKey,
    });

    try {
      input.onProgress?.(
        22,
        platform === 'aistudio'
          ? `Opening AI Studio (${model.label})...`
          : `Opening Gemini Web Videos (${model.label})...`,
      );

      await page.goto(model.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForTimeout(1400);

      input.onProgress?.(35, 'Configuring video model & run settings...');
      if (platform === 'gemini') {
        await configureGeminiWebControls(page, model, input.runSettings);
      } else {
        await configureAiStudioRunSettings(page, model, input.runSettings);
      }

      if (input.attachments && input.attachments.length > 0) {
        input.onProgress?.(45, 'Uploading reference frame / video...');
        await attachFilesToPage(page, input.attachments);
      }

      input.onProgress?.(55, 'Submitting prompt & waiting for video synthesis...');
      await submitPromptInPage(page, platform, input.prompt);

      const maxWaitMs = 360_000;
      const startedWait = Date.now();
      let videoB64: string | null = null;

      while (Date.now() - startedWait < maxWaitMs) {
        if (input.signal?.aborted) {
          throw new DomainError(
            ErrorCode.PROVIDER_ERROR,
            499,
            'Browser video generation aborted',
          );
        }

        await page.waitForTimeout(2000);

        const elapsedSec = Math.round((Date.now() - startedWait) / 1000);
        input.onProgress?.(
          Math.min(90, 55 + Math.floor(elapsedSec / 3)),
          `Rendering video with ${model.label} (${elapsedSec}s)...`,
        );

        const b64 = await page.evaluate(async () => {
          const doc = (globalThis as unknown as {
            document: {
              querySelectorAll: (sel: string) => ArrayLike<{
                currentSrc?: string;
                src?: string;
                querySelector?: (s: string) => { src?: string } | null;
              }>;
            };
          }).document;
          const videos = Array.from(doc.querySelectorAll('video'));
          for (const vid of videos.reverse()) {
            const src =
              vid.currentSrc ||
              vid.src ||
              vid.querySelector?.('source')?.src ||
              '';
            if (!src) continue;
            try {
              const res = await fetch(src);
              if (!res.ok) continue;
              const ab = await res.arrayBuffer();
              if (ab.byteLength < 1024) continue;
              const bytes = new Uint8Array(ab);
              let binary = '';
              for (let i = 0; i < bytes.byteLength; i++) {
                binary += String.fromCharCode(bytes[i]!);
              }
              return btoa(binary);
            } catch {
              // Try next video element
            }
          }
          return null;
        });

        if (b64) {
          videoB64 = b64;
          break;
        }
      }

      const chatUrl = page.url();
      await this.browserService.recordTrackedChat({
        providerConfigId: input.providerConfigId,
        projectId: input.projectId,
        jobId: input.jobId,
        role: 'GENERATOR',
        modality: 'VIDEO',
        platform,
        modelId: model.id,
        chatUrl,
        chatTitle: input.prompt.slice(0, 80),
      });

      if (!videoB64) {
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          `No video output was produced by ${model.label} (${chatUrl})`,
        );
      }

      input.onProgress?.(95, 'Extracting generated video...');
      return {
        buffer: Buffer.from(videoB64, 'base64'),
        mimeType: 'video/mp4',
        chatUrl,
      };
    } finally {
      this.browserService.releasePage(trackingKey, page, true);
    }
  }
}
