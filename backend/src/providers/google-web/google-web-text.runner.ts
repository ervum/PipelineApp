import {
  ErrorCode,
  findGoogleWebModel,
  GOOGLE_WEB_MODEL_CATALOG,
  GoogleWebModelDefinition,
  GoogleWebRunSettings,
} from '@forge/shared';
import { Injectable, Logger } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { GoogleWebBrowserService } from './google-web-browser.service';
import {
  attachFilesToPage,
  configureAiStudioRunSettings,
  configureGeminiWebControls,
  submitPromptInPage,
  TempAttachment,
} from './google-web-dom.helpers';

export interface GoogleWebTextRunInput {
  modelId: string;
  prompt: string;
  systemPrompt?: string;
  attachments?: TempAttachment[];
  runSettings?: GoogleWebRunSettings;
  headless?: boolean;
  autoDeleteChat?: boolean;
  providerConfigId?: string;
  projectId?: string;
  jobId?: string;
  role: 'MIDDLEMAN' | 'GENERATOR';
  modality?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number, stage: string) => void;
}

@Injectable()
export class GoogleWebTextRunner {
  private readonly logger = new Logger(GoogleWebTextRunner.name);

  constructor(private readonly browserService: GoogleWebBrowserService) {}

  resolveTextModel(modelId: string): GoogleWebModelDefinition {
    const found = findGoogleWebModel(modelId);
    if (found) return found;
    return GOOGLE_WEB_MODEL_CATALOG[0]!;
  }

  async runTextGeneration(
    input: GoogleWebTextRunInput,
  ): Promise<{ text: string; chatUrl: string }> {
    const model = this.resolveTextModel(input.modelId);
    const platform: 'gemini' | 'aistudio' =
      model.authMode === 'aistudio' ? 'aistudio' : 'gemini';
    const trackingKey = input.jobId ?? `middleman-${Date.now()}`;

    input.onProgress?.(10, 'Initializing browser...');
    const page = await this.browserService.openPageWithRecovery({
      headless: input.headless,
      trackingKey,
    });

    let createdChatId: string | null = null;

    try {
      input.onProgress?.(
        22,
        platform === 'aistudio'
          ? 'Opening Google AI Studio...'
          : 'Opening Gemini Web...',
      );

      await page.goto(model.targetUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 45000,
      });
      await page.waitForTimeout(1200);

      input.onProgress?.(35, 'Configuring model & run settings...');
      if (platform === 'gemini') {
        await configureGeminiWebControls(page, model, input.runSettings);
      } else {
        await configureAiStudioRunSettings(page, model, input.runSettings);
      }

      if (input.attachments && input.attachments.length > 0) {
        input.onProgress?.(45, 'Uploading reference attachments...');
        await attachFilesToPage(page, input.attachments);
      }

      const fullPrompt = input.systemPrompt
        ? `${input.systemPrompt}\n\n---\n\n${input.prompt}`
        : input.prompt;

      input.onProgress?.(55, 'Submitting prompt & waiting for AI response...');
      await submitPromptInPage(page, platform, fullPrompt);

      // Wait for response text to appear and stabilize
      const responseSelector =
        platform === 'gemini'
          ? 'message-content, model-response, .model-response-text, [data-message-author-role="model"]'
          : 'ms-chat-turn[role="model"], .model-prompt-container, ms-cmark-node';

      let lastText = '';
      let stableTicks = 0;
      const maxWaitMs = 180_000;
      const startedWait = Date.now();

      while (Date.now() - startedWait < maxWaitMs) {
        if (input.signal?.aborted) {
          throw new DomainError(
            ErrorCode.PROVIDER_ERROR,
            499,
            'Browser text generation aborted',
          );
        }

        await page.waitForTimeout(1000);

        const nodes = page.locator(responseSelector);
        const count = await nodes.count();
        if (count > 0) {
          const latestNode = nodes.nth(count - 1);
          const currentText = ((await latestNode.innerText().catch(() => '')) ?? '').trim();

          if (currentText.length > 0) {
            if (currentText === lastText) {
              stableTicks += 1;
              if (stableTicks >= 3) {
                break;
              }
            } else {
              lastText = currentText;
              stableTicks = 0;
              input.onProgress?.(
                Math.min(90, 60 + Math.floor(currentText.length / 80)),
                `Receiving AI response (${currentText.length} chars)...`,
              );
            }
          }
        }
      }

      const chatUrl = page.url();
      const recorded = await this.browserService.recordTrackedChat({
        providerConfigId: input.providerConfigId,
        projectId: input.projectId,
        jobId: input.jobId,
        role: input.role,
        modality: input.modality ?? 'LORE',
        platform,
        modelId: model.id,
        chatUrl,
        chatTitle: input.prompt.slice(0, 80),
      });
      if (recorded) {
        createdChatId = recorded.id;
      }

      if (!lastText) {
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          `No text response returned from ${model.label} (${chatUrl})`,
        );
      }

      input.onProgress?.(95, 'Extracting response...');
      return { text: lastText, chatUrl };
    } finally {
      this.browserService.releasePage(trackingKey, page, true);
      if (input.autoDeleteChat && !input.jobId && createdChatId) {
        await this.browserService
          .deleteWebChatById(createdChatId)
          .catch((err) =>
            this.logger.warn(`Auto-delete chat warning: ${String(err)}`),
          );
      }
    }
  }
}
