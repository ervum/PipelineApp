import { ErrorCode, ProviderKind } from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { HttpClientService } from '../../common/http/http-client.service';
import { readSse } from '../../common/http/sse-reader';
import { ProviderRuntimeConfig } from '../../providers/providers.service';
import { BaseLlmAdapter, LlmRequest, LlmStreamEvent } from './llm-adapter.interface';

@Injectable()
export class OpenAiCompatibleLlmAdapter extends BaseLlmAdapter {
  readonly kind = ProviderKind.OPENAI_COMPATIBLE;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async *stream(cfg: ProviderRuntimeConfig, req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    if (!cfg.baseUrl) {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        'OpenAI-compatible baseUrl is required',
      );
    }

    const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    const headers: Record<string, string> = { ...cfg.extraHeaders };
    if (cfg.secret) {
      headers['Authorization'] = `Bearer ${cfg.secret}`;
    }

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

    const supportsJsonMode = cfg.settings.supportsJsonMode !== false;

    const body: Record<string, unknown> = {
      model: req.model || cfg.defaultModel || 'local-llm',
      temperature: req.temperature,
      max_tokens: req.maxOutputTokens,
      stream: true,
      ...(req.jsonMode && supportsJsonMode
        ? { response_format: { type: 'json_object' } }
        : {}),
      messages: [
        { role: 'system', content: req.system },
        { role: 'user', content: userContent },
      ],
    };

    const streamBody = await this.http.request<ReadableStream<Uint8Array>>(
      `${baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers,
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
