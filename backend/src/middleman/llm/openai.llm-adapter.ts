import { ErrorCode, ProviderKind } from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { HttpClientService } from '../../common/http/http-client.service';
import { readSse } from '../../common/http/sse-reader';
import { ProviderRuntimeConfig } from '../../providers/providers.service';
import { BaseLlmAdapter, LlmRequest, LlmStreamEvent } from './llm-adapter.interface';

@Injectable()
export class OpenAiLlmAdapter extends BaseLlmAdapter {
  readonly kind = ProviderKind.OPENAI;

  constructor(protected readonly http: HttpClientService) {
    super();
  }

  async *stream(cfg: ProviderRuntimeConfig, req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    if (!cfg.secret) {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        'OpenAI API key is not configured',
      );
    }

    const baseUrl = (cfg.baseUrl ?? 'https://api.openai.com').replace(/\/+$/, '');
    const userContent = req.userParts.map((part) => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text };
      }
      return {
        type: 'image_url',
        image_url: {
          url: `data:${part.mimeType};base64,${part.base64}`,
        },
      };
    });

    const responseFormat = req.jsonMode
      ? req.jsonSchema
        ? {
            type: 'json_schema',
            json_schema: {
              name: 'compiled_prompt',
              strict: false,
              schema: req.jsonSchema,
            },
          }
        : { type: 'json_object' }
      : undefined;

    const body: Record<string, unknown> = {
      model: req.model || cfg.defaultModel || 'gpt-5-mini',
      temperature: req.temperature,
      max_completion_tokens: req.maxOutputTokens,
      stream: true,
      stream_options: { include_usage: true },
      ...(responseFormat ? { response_format: responseFormat } : {}),
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: userContent },
      ],
    };

    const streamBody = await this.http.request<ReadableStream<Uint8Array>>(
      `${baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: {
          ...cfg.extraHeaders,
          Authorization: `Bearer ${cfg.secret}`,
        },
        body,
        timeoutMs: cfg.settings.timeoutMs,
        responseType: 'stream',
        signal: req.signal,
      },
    );

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const sse of readSse(streamBody)) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(sse.data) as Record<string, unknown>;
      } catch {
        continue;
      }

      const choices = parsed['choices'] as
        | Array<{ delta?: { content?: string | null } }>
        | undefined;
      const contentDelta = choices?.[0]?.delta?.content;
      if (typeof contentDelta === 'string' && contentDelta.length > 0) {
        yield { type: 'delta', text: contentDelta };
      }

      const usage = parsed['usage'] as
        | { prompt_tokens?: number; completion_tokens?: number }
        | undefined;
      if (usage) {
        if (typeof usage.prompt_tokens === 'number') {
          inputTokens = usage.prompt_tokens;
        }
        if (typeof usage.completion_tokens === 'number') {
          outputTokens = usage.completion_tokens;
        }
      }
    }

    yield { type: 'done', usage: { inputTokens, outputTokens } };
  }
}
