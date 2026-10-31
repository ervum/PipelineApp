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

export interface GoogleWebImageRunInput {
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

export interface ExtractedWebImage {
  buffer: Buffer;
  mimeType: string;
  accompanyingText?: string;
}

@Injectable()
export class GoogleWebImageRunner {
  constructor(private readonly browserService: GoogleWebBrowserService) {}

  resolveImageModel(modelId: string): GoogleWebModelDefinition {
    const found = findGoogleWebModel(modelId);
    if (found && found.category === 'image') return found;
    return (
      GOOGLE_WEB_MODEL_CATALOG.find((m) => m.category === 'image') ??
      GOOGLE_WEB_MODEL_CATALOG[0]!
    );
  }

  async runImageGeneration(
    input: GoogleWebImageRunInput,
  ): Promise<{ images: ExtractedWebImage[]; chatUrl: string }> {
    const model = this.resolveImageModel(input.modelId);
    const platform: 'gemini' | 'aistudio' =
      model.authMode === 'aistudio' ? 'aistudio' : 'gemini';
    const trackingKey = input.jobId ?? `img-${Date.now()}`;

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
          : `Opening Gemini Web Images (${model.label})...`,
      );

      await page.goto(model.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForTimeout(1400);

      input.onProgress?.(35, 'Configuring model & run settings...');
      if (platform === 'gemini') {
        await configureGeminiWebControls(page, model, input.runSettings);
      } else {
        await configureAiStudioRunSettings(page, model, input.runSettings);
      }

      if (input.attachments && input.attachments.length > 0) {
        input.onProgress?.(45, 'Uploading reference image...');
        await attachFilesToPage(page, input.attachments);
      }

      input.onProgress?.(55, 'Submitting prompt & waiting for image synthesis...');
      await submitPromptInPage(page, platform, input.prompt);

      const maxWaitMs = 240_000;
      const startedWait = Date.now();
      let extractedDataUris: string[] = [];
      let accompanyingText = '';

      while (Date.now() - startedWait < maxWaitMs) {
        if (input.signal?.aborted) {
          throw new DomainError(
            ErrorCode.PROVIDER_ERROR,
            499,
            'Browser image generation aborted',
          );
        }

        await page.waitForTimeout(1500);

        const elapsedSec = Math.round((Date.now() - startedWait) / 1000);
        input.onProgress?.(
          Math.min(88, 55 + Math.floor(elapsedSec / 2)),
          `Synthesizing image with ${model.label} (${elapsedSec}s)...`,
        );

        const found = await page.evaluate(async () => {
          const doc = (globalThis as unknown as {
            document: {
              querySelectorAll: (sel: string) => ArrayLike<{
                complete?: boolean;
                naturalWidth?: number;
                naturalHeight?: number;
                src?: string;
                innerText?: string;
              }>;
              createElement: (tag: string) => {
                width: number;
                height: number;
                getContext: (id: string) => {
                  drawImage: (img: unknown, x: number, y: number) => void;
                } | null;
                toDataURL: (mime: string) => string;
              };
            };
          }).document;

          const imgs = Array.from(
            doc.querySelectorAll(
              'message-content img, model-response img, ms-chat-turn img, .generated-image img, img[src^="blob:"], img[src^="data:image/"]',
            ),
          ).filter(
            (img) =>
              Boolean(img.complete) &&
              (img.naturalWidth ?? 0) >= 192 &&
              (img.naturalHeight ?? 0) >= 192 &&
              !(img.src ?? '').includes('avatar') &&
              !(img.src ?? '').includes('profile'),
          );

          if (imgs.length === 0) {
            return null;
          }

          const dataUris: string[] = [];
          for (const img of imgs) {
            try {
              const canvas = doc.createElement('canvas');
              canvas.width = img.naturalWidth ?? 512;
              canvas.height = img.naturalHeight ?? 512;
              const ctx = canvas.getContext('2d');
              if (ctx) {
                ctx.drawImage(img, 0, 0);
                dataUris.push(canvas.toDataURL('image/png'));
              }
            } catch {
              if ((img.src ?? '').startsWith('data:image/')) {
                dataUris.push(img.src!);
              }
            }
          }

          if (dataUris.length === 0) return null;

          const turnNodes = doc.querySelectorAll(
            'message-content, model-response, ms-chat-turn[role="model"]',
          );
          const lastTurn = turnNodes[turnNodes.length - 1];
          const text = lastTurn?.innerText?.trim() ?? '';

          return { dataUris, text };
        });

        if (found && found.dataUris.length > 0) {
          extractedDataUris = found.dataUris;
          accompanyingText = found.text;
          break;
        }
      }

      const chatUrl = page.url();
      await this.browserService.recordTrackedChat({
        providerConfigId: input.providerConfigId,
        projectId: input.projectId,
        jobId: input.jobId,
        role: 'GENERATOR',
        modality: input.modality ?? 'IMAGES',
        platform,
        modelId: model.id,
        chatUrl,
        chatTitle: input.prompt.slice(0, 80),
      });

      if (extractedDataUris.length === 0) {
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          `No generated image was produced by ${model.label} (${chatUrl})`,
        );
      }

      input.onProgress?.(94, 'Extracting generated image...');
      const images: ExtractedWebImage[] = extractedDataUris.map((uri) => {
        const commaIdx = uri.indexOf(',');
        const b64 = commaIdx >= 0 ? uri.slice(commaIdx + 1) : uri;
        return {
          buffer: Buffer.from(b64, 'base64'),
          mimeType: 'image/png',
          ...(accompanyingText ? { accompanyingText } : {}),
        };
      });

      return { images, chatUrl };
    } finally {
      this.browserService.releasePage(trackingKey, page, true);
    }
  }
}
