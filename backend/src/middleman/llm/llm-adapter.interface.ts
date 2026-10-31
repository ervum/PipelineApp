import { ProviderKind } from '@forge/shared';
import { ProviderRuntimeConfig } from '../../providers/providers.service';

export type LlmMessagePart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; base64: string };

export interface LlmRequest {
  model: string;
  system: string;
  userParts: LlmMessagePart[];
  temperature: number;
  maxOutputTokens: number;
  jsonMode: boolean;
  jsonSchema?: Record<string, unknown>;
  signal?: AbortSignal;
}

export type LlmStreamEvent =
  | { type: 'delta'; text: string }
  | { type: 'done'; usage: { inputTokens: number; outputTokens: number } };

export interface ILlmAdapter {
  readonly kind: ProviderKind;
  stream(cfg: ProviderRuntimeConfig, req: LlmRequest): AsyncGenerator<LlmStreamEvent>;
  complete(
    cfg: ProviderRuntimeConfig,
    req: LlmRequest,
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }>;
}

export abstract class BaseLlmAdapter implements ILlmAdapter {
  abstract readonly kind: ProviderKind;

  abstract stream(cfg: ProviderRuntimeConfig, req: LlmRequest): AsyncGenerator<LlmStreamEvent>;

  async complete(
    cfg: ProviderRuntimeConfig,
    req: LlmRequest,
  ): Promise<{ text: string; usage: { inputTokens: number; outputTokens: number } }> {
    let text = '';
    let usage = { inputTokens: 0, outputTokens: 0 };
    for await (const evt of this.stream(cfg, req)) {
      if (evt.type === 'delta') {
        text += evt.text;
      } else if (evt.type === 'done') {
        usage = evt.usage;
      }
    }
    return { text, usage };
  }
}
