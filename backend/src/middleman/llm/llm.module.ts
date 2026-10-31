import { Module } from '@nestjs/common';
import { HttpClientService } from '../../common/http/http-client.service';
import { ProvidersModule } from '../../providers/providers.module';
import { AnthropicLlmAdapter } from './anthropic.llm-adapter';
import { DemoLlmAdapter } from './demo.llm-adapter';
import { GeminiLlmAdapter } from './gemini.llm-adapter';
import { GoogleWebLlmAdapter } from './google-web.llm-adapter';
import { ILlmAdapter } from './llm-adapter.interface';
import { LLM_ADAPTERS, LlmAdapterRegistry } from './llm-adapter.registry';
import { OllamaLlmAdapter } from './ollama.llm-adapter';
import { OpenAiCompatibleLlmAdapter } from './openai-compatible.llm-adapter';
import { OpenAiLlmAdapter } from './openai.llm-adapter';

@Module({
  imports: [ProvidersModule],
  providers: [
    HttpClientService,
    AnthropicLlmAdapter,
    OpenAiLlmAdapter,
    GeminiLlmAdapter,
    GoogleWebLlmAdapter,
    OllamaLlmAdapter,
    OpenAiCompatibleLlmAdapter,
    DemoLlmAdapter,
    {
      provide: LLM_ADAPTERS,
      useFactory: (
        anthropic: AnthropicLlmAdapter,
        openai: OpenAiLlmAdapter,
        gemini: GeminiLlmAdapter,
        googleWeb: GoogleWebLlmAdapter,
        ollama: OllamaLlmAdapter,
        openaiCompat: OpenAiCompatibleLlmAdapter,
        demo: DemoLlmAdapter,
      ): ILlmAdapter[] => [
        anthropic,
        openai,
        gemini,
        googleWeb,
        ollama,
        openaiCompat,
        demo,
      ],
      inject: [
        AnthropicLlmAdapter,
        OpenAiLlmAdapter,
        GeminiLlmAdapter,
        GoogleWebLlmAdapter,
        OllamaLlmAdapter,
        OpenAiCompatibleLlmAdapter,
        DemoLlmAdapter,
      ],
    },
    LlmAdapterRegistry,
  ],
  exports: [LlmAdapterRegistry, HttpClientService],
})
export class LlmModule {}
