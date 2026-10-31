import { ErrorCode, ProviderKind } from '@forge/shared';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain.error';
import { ILlmAdapter } from './llm-adapter.interface';

export const LLM_ADAPTERS = Symbol('LLM_ADAPTERS');

@Injectable()
export class LlmAdapterRegistry {
  private readonly byKind = new Map<ProviderKind, ILlmAdapter>();

  constructor(@Inject(LLM_ADAPTERS) adapters: ILlmAdapter[]) {
    for (const adapter of adapters) {
      this.byKind.set(adapter.kind, adapter);
    }
  }

  get(kind: ProviderKind): ILlmAdapter {
    const adapter = this.byKind.get(kind);
    if (!adapter) {
      throw new DomainError(
        ErrorCode.MODALITY_UNSUPPORTED,
        400,
        `Provider kind ${kind} does not have an LLM adapter`,
      );
    }
    return adapter;
  }

  has(kind: ProviderKind): boolean {
    return this.byKind.has(kind);
  }
}
