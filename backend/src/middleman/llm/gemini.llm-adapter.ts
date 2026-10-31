import { ErrorCode, estimateTokens, ProviderKind } from '@forge/shared';
import { GoogleGenAI, Interactions } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { ProviderRuntimeConfig } from '../../providers/providers.service';
import { BaseLlmAdapter, LlmRequest, LlmStreamEvent } from './llm-adapter.interface';

@Injectable()
export class GeminiLlmAdapter extends BaseLlmAdapter {
  readonly kind = ProviderKind.GEMINI;

  async *stream(cfg: ProviderRuntimeConfig, req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    if (!cfg.secret) {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        'Gemini API key is not configured',
      );
    }

    const rawModel = req.model || cfg.defaultModel || 'gemini-3.8-flash';
    const model = rawModel.startsWith('gemini-2.') ? 'gemini-3.8-flash' : rawModel;

    const ai = new GoogleGenAI({ apiKey: cfg.secret });

    const inputContent: Array<Interactions.TextContent | Interactions.ImageContent> =
      req.userParts.map((part) => {
        if (part.type === 'text') {
          return {
            type: 'text',
            text: part.text,
          };
        }
        return {
          type: 'image',
          data: part.base64,
          mime_type: part.mimeType,
        };
      });

    const responseFormat: Interactions.TextResponseFormat | undefined = req.jsonMode
      ? {
          type: 'text',
          mime_type: 'application/json',
          ...(req.jsonSchema ? { schema: req.jsonSchema } : {}),
        }
      : undefined;

    let interactionStream: AsyncIterable<Interactions.InteractionSSEEvent>;
    try {
      interactionStream = await ai.interactions.create({
        model,
        system_instruction: req.system,
        input: inputContent,
        generation_config: {
          temperature: req.temperature,
          max_output_tokens: req.maxOutputTokens,
        },
        ...(responseFormat ? { response_format: responseFormat } : {}),
        stream: true,
        store: false,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (/401|403|api_key|unauthenticated/i.test(msg)) {
        throw new DomainError(ErrorCode.PROVIDER_AUTH_FAILED, 502, `Gemini auth failed: ${msg}`);
      }
      if (/429|quota|rate/i.test(msg)) {
        throw new DomainError(ErrorCode.PROVIDER_RATE_LIMITED, 429, `Gemini rate limited: ${msg}`);
      }
      throw new DomainError(ErrorCode.PROVIDER_ERROR, 502, `Gemini request failed: ${msg}`);
    }

    let inputTokens = 0;
    let outputTokens = 0;
    let accumulated = '';

    for await (const event of interactionStream) {
      if (req.signal?.aborted) {
        throw new DomainError(ErrorCode.PROVIDER_ERROR, 499, 'Gemini stream aborted');
      }
      if (event.event_type === 'step.delta' && event.delta?.type === 'text') {
        const chunk = event.delta.text ?? '';
        if (chunk.length > 0) {
          accumulated += chunk;
          yield { type: 'delta', text: chunk };
        }
      } else if (event.event_type === 'interaction.completed') {
        const usage = event.interaction.usage;
        if (typeof usage?.total_input_tokens === 'number') {
          inputTokens = usage.total_input_tokens;
        }
        if (typeof usage?.total_output_tokens === 'number') {
          outputTokens = usage.total_output_tokens;
        }
      }
    }

    if (inputTokens === 0) {
      inputTokens = estimateTokens(req.system);
    }
    if (outputTokens === 0) {
      outputTokens = estimateTokens(accumulated);
    }

    yield { type: 'done', usage: { inputTokens, outputTokens } };
  }
}
