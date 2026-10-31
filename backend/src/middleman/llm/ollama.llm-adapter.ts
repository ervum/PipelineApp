import { ErrorCode, ProviderKind } from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { HttpClientService } from '../../common/http/http-client.service';
import { readNdjson } from '../../common/http/ndjson-reader';
import { ProviderRuntimeConfig } from '../../providers/providers.service';
import { BaseLlmAdapter, LlmRequest, LlmStreamEvent } from './llm-adapter.interface';

interface OllamaStreamChunk {
  message?: {
    role?: string;
    content?: string;
  };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

@Injectable()
export class OllamaLlmAdapter extends BaseLlmAdapter {
  readonly kind = ProviderKind.OLLAMA;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async *stream(cfg: ProviderRuntimeConfig, req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    if (!cfg.baseUrl) {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        'Ollama baseUrl is not configured',
      );
    }

    const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
    const textContent = req.userParts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n\n');
    const images = req.userParts
      .filter((p): p is { type: 'image'; mimeType: string; base64: string } => p.type === 'image')
      .map((p) => p.base64);

    const body: Record<string, unknown> = {
      model: req.model || cfg.defaultModel || 'qwen2.5:14b',
      stream: true,
      ...(req.jsonMode ? { format: req.jsonSchema ?? 'json' } : {}),
      options: {
        temperature: req.temperature,
        num_predict: req.maxOutputTokens,
      },
      messages: [
        { role: 'system', content: req.system },
        {
          role: 'user',
          content: textContent,
          ...(images.length > 0 ? { images } : {}),
        },
      ],
    };

    const streamBody = await this.http.request<ReadableStream<Uint8Array>>(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { ...cfg.extraHeaders },
      body,
      timeoutMs: cfg.settings.timeoutMs,
      responseType: 'stream',
      signal: req.signal,
    });

    let inputTokens = 0;
    let outputTokens = 0;

    for await (const chunk of readNdjson<OllamaStreamChunk>(streamBody)) {
      if (chunk.message?.content) {
        yield { type: 'delta', text: chunk.message.content };
      }
      if (chunk.done) {
        inputTokens = chunk.prompt_eval_count ?? 0;
        outputTokens = chunk.eval_count ?? 0;
      }
    }

    yield { type: 'done', usage: { inputTokens, outputTokens } };
  }
}
