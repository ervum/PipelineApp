import { ErrorCode, ProviderKind } from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { HttpClientService } from '../../common/http/http-client.service';
import { readSse } from '../../common/http/sse-reader';
import { ProviderRuntimeConfig } from '../../providers/providers.service';
import { BaseLlmAdapter, LlmRequest, LlmStreamEvent } from './llm-adapter.interface';

@Injectable()
export class AnthropicLlmAdapter extends BaseLlmAdapter {
  readonly kind = ProviderKind.ANTHROPIC;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async *stream(cfg: ProviderRuntimeConfig, req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    if (!cfg.secret) {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        'Anthropic API key is not configured',
      );
    }

    const baseUrl = (cfg.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    const systemText = req.jsonMode
      ? `${req.system}\n\nRespond with a single JSON object and nothing else.`
      : req.system;

    const contentBlocks = req.userParts.map((part) => {
      if (part.type === 'text') {
        return { type: 'text', text: part.text };
      }
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: part.mimeType,
          data: part.base64,
        },
      };
    });

    const body = {
      model: req.model || cfg.defaultModel || 'claude-sonnet-4-5',
      system: systemText,
      max_tokens: req.maxOutputTokens,
      temperature: req.temperature,
      stream: true,
      messages: [
        {
          role: 'user',
          content: contentBlocks,
        },
      ],
    };

    const streamBody = await this.http.request<ReadableStream<Uint8Array>>(
      `${baseUrl}/v1/messages`,
      {
        method: 'POST',
        headers: {
          ...cfg.extraHeaders,
          'x-api-key': cfg.secret,
          'anthropic-version': '2023-06-01',
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

      const evtType = (parsed['type'] as string | undefined) ?? sse.event;
      if (evtType === 'message_start') {
        const message = parsed['message'] as { usage?: { input_tokens?: number } } | undefined;
        if (typeof message?.usage?.input_tokens === 'number') {
          inputTokens = message.usage.input_tokens;
        }
      } else if (evtType === 'content_block_delta') {
        const delta = parsed['delta'] as { type?: string; text?: string } | undefined;
        if (delta?.type === 'text_delta' && typeof delta.text === 'string' && delta.text.length > 0) {
          yield { type: 'delta', text: delta.text };
        }
      } else if (evtType === 'message_delta') {
        const usage = parsed['usage'] as { output_tokens?: number } | undefined;
        if (typeof usage?.output_tokens === 'number') {
          outputTokens = usage.output_tokens;
        }
      }
    }

    yield { type: 'done', usage: { inputTokens, outputTokens } };
  }
}
