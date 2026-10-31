import { estimateTokens, ProviderKind } from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { GoogleWebTextRunner } from '../../providers/google-web/google-web-text.runner';
import { TempAttachment } from '../../providers/google-web/google-web-dom.helpers';
import { ProviderRuntimeConfig } from '../../providers/providers.service';
import { BaseLlmAdapter, LlmRequest, LlmStreamEvent } from './llm-adapter.interface';

@Injectable()
export class GoogleWebLlmAdapter extends BaseLlmAdapter {
  readonly kind = ProviderKind.GOOGLE_WEB;

  constructor(private readonly textRunner: GoogleWebTextRunner) {
    super();
  }

  async *stream(
    cfg: ProviderRuntimeConfig,
    req: LlmRequest,
  ): AsyncGenerator<LlmStreamEvent> {
    const modelId =
      req.model ||
      cfg.defaultModel ||
      (cfg.settings.webAuthMode === 'aistudio'
        ? 'aistudio:gemini-4.0-argon'
        : cfg.settings.webAuthMode === 'gemini_auth'
          ? 'gemini-web:4.0-argon'
          : 'gemini-web-guest:3.5-flash-lite');

    const textParts: string[] = [];
    const attachments: TempAttachment[] = [];

    for (let i = 0; i < req.userParts.length; i++) {
      const part = req.userParts[i]!;
      if (part.type === 'text') {
        textParts.push(part.text);
      } else if (part.type === 'image') {
        const ext = part.mimeType.includes('png') ? 'png' : 'jpg';
        attachments.push({
          buffer: Buffer.from(part.base64, 'base64'),
          mimeType: part.mimeType,
          fileName: `vision_ref_${i + 1}.${ext}`,
        });
      }
    }

    let systemPrompt = req.system;
    if (req.jsonMode) {
      const schemaHint = req.jsonSchema
        ? `\nRequired JSON Schema: ${JSON.stringify(req.jsonSchema)}`
        : '';
      systemPrompt = `${systemPrompt}\n\nIMPORTANT: Respond ONLY with valid raw JSON and no markdown code fences.${schemaHint}`;
    }

    const res = await this.textRunner.runTextGeneration({
      modelId,
      prompt: textParts.join('\n\n'),
      systemPrompt,
      attachments,
      runSettings: {
        temperature: req.temperature,
        outputLength: req.maxOutputTokens,
        structuredOutputs: req.jsonMode,
      },
      headless: cfg.settings.browserHeadless ?? true,
      autoDeleteChat: cfg.settings.autoDeleteCreatedChats ?? false,
      providerConfigId: cfg.id,
      role: 'MIDDLEMAN',
      signal: req.signal,
    });

    yield { type: 'delta', text: res.text };
    yield {
      type: 'done',
      usage: {
        inputTokens: estimateTokens(`${systemPrompt}\n${textParts.join('\n')}`),
        outputTokens: estimateTokens(res.text),
      },
    };
  }
}
