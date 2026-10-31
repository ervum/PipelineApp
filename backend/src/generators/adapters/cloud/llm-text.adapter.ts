import {
  AssetFileRole,
  ErrorCode,
  GenerationSubMode,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';
import { LlmAdapterRegistry } from '../../../middleman/llm/llm-adapter.registry';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import {
  GeneratorDispatchContext,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

const BUILTIN_LORE_SCHEMAS: Record<string, Record<string, unknown>> = {
  ITEM_TABLE: {
    type: 'object',
    properties: {
      schemaKind: { type: 'string' },
      items: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            rarity: { type: 'string' },
            description: { type: 'string' },
            value: { type: 'number' },
          },
          required: ['id', 'name', 'rarity', 'description'],
        },
      },
    },
    required: ['items'],
  },
  DIALOGUE_TREE: {
    type: 'object',
    properties: {
      npcId: { type: 'string' },
      nodes: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            speaker: { type: 'string' },
            line: { type: 'string' },
          },
          required: ['id', 'speaker', 'line'],
        },
      },
    },
    required: ['nodes'],
  },
  QUEST: {
    type: 'object',
    properties: {
      questId: { type: 'string' },
      title: { type: 'string' },
      summary: { type: 'string' },
      stages: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            stageId: { type: 'string' },
            objective: { type: 'string' },
          },
          required: ['stageId', 'objective'],
        },
      },
    },
    required: ['questId', 'title', 'stages'],
  },
  LOOT_TABLE: {
    type: 'object',
    properties: {
      tableId: { type: 'string' },
      rolls: { type: 'number' },
      entries: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            itemId: { type: 'string' },
            weight: { type: 'number' },
          },
          required: ['itemId', 'weight'],
        },
      },
    },
    required: ['entries'],
  },
};

@Injectable()
export class LlmTextAdapter extends BaseGeneratorAdapter {
  readonly id = 'llm-text';
  readonly providerKind = ProviderKind.OPENAI;
  readonly supportedProviderKinds = [
    ProviderKind.ANTHROPIC,
    ProviderKind.OPENAI,
    ProviderKind.GEMINI,
    ProviderKind.GOOGLE_WEB,
    ProviderKind.OLLAMA,
    ProviderKind.OPENAI_COMPATIBLE,
    ProviderKind.DEMO,
  ] as const;
  readonly modalities = [Modality.OTHER, Modality.LORE] as const;
  readonly subModes = [
    GenerationSubMode.STANDARD,
    GenerationSubMode.SHADER_CODE,
    GenerationSubMode.LORE_JSON,
  ] as const;
  readonly tier = 'ANY' as const;

  constructor(private readonly llmRegistry: LlmAdapterRegistry) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const llmAdapter = this.llmRegistry.get(ctx.provider.kind);
    const fallbackModel =
      ctx.provider.kind === ProviderKind.ANTHROPIC
        ? 'claude-sonnet-4-5'
        : ctx.provider.kind === ProviderKind.GEMINI
          ? 'gemini-3.8-flash'
          : ctx.provider.kind === ProviderKind.GOOGLE_WEB
            ? 'gemini-web-guest:3.5-flash-lite'
            : ctx.provider.kind === ProviderKind.OLLAMA
            ? 'llama3.1:8b'
            : ctx.provider.kind === ProviderKind.DEMO
              ? 'demo-middleman-v1'
              : 'gpt-5-mini';

    const model = this.pickModel(ctx, fallbackModel);
    const temperature = this.num(
      ctx.mergedParams,
      'temperature',
      ctx.modality === Modality.LORE ? 0.65 : 0.2,
    );

    if (ctx.modality === Modality.LORE) {
      const loreParams =
        ctx.params.modality === Modality.LORE ? ctx.params : null;
      const batchCount = Math.max(1, loreParams?.batchCount ?? 1);
      const lengthForm = loreParams?.lengthForm ?? 'SHORT_FORM';
      const loreCategory = loreParams?.loreCategory ?? 'ITEM_DESCRIPTION';
      const tone = loreParams?.tone ?? 'IN_WORLD_DIEGETIC';
      const perspective = loreParams?.perspective ?? 'THIRD_PERSON_OMNISCIENT';
      const targetWordCount = loreParams?.targetWordCount ?? 120;
      const includeSections = loreParams?.includeSections ?? false;
      const outputFormat = loreParams?.outputFormat ?? 'MARKDOWN';
      const ext = outputFormat === 'PLAIN_TEXT' ? 'txt' : 'md';
      const mimeType =
        outputFormat === 'PLAIN_TEXT' ? 'text/plain' : 'text/markdown';

      const system = [
        `You are the lead narrative designer and lore chronicler for the game project "${ctx.project.name}" (${ctx.project.genre}).`,
        `Write ${lengthForm} game lore (${loreCategory}) in ${outputFormat} format.`,
        `Tone: ${tone}. Perspective: ${perspective}. Target length: ~${targetWordCount} words.`,
        includeSections
          ? 'Include structured section headings, an opening epigraph quote, and a narrative/gameplay hooks callout.'
          : 'Write cohesive, evocative prose without extra metadata wrappers.',
      ].join(' ');

      const outputs = [];
      for (let i = 0; i < batchCount; i++) {
        const res = await llmAdapter.complete(ctx.provider, {
          model,
          system,
          userParts: [{ type: 'text', text: ctx.compiled.enhancedPrompt }],
          temperature,
          maxOutputTokens: Math.min(8000, Math.max(1024, targetWordCount * 3)),
          jsonMode: false,
          signal: ctx.signal,
        });
        const text = res.text.trim() + '\n';
        const words = text
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0);
        const wordCount = words.length;
        const charCount = text.length;
        const readingTimeSec = Math.max(5, Math.round((wordCount / 200) * 60));
        const excerpt = text
          .replace(/[#>*_`~-]/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
          .slice(0, 220);

        outputs.push({
          kind: 'text' as const,
          data: text,
          mimeType,
          fileName: `lore_${i + 1}.${ext}`,
          role: AssetFileRole.PRIMARY,
          batchIndex: i,
          metadata: {
            lengthForm,
            loreCategory,
            tone,
            perspective,
            wordCount,
            charCount,
            readingTimeSec,
            outputFormat,
            excerpt,
          },
        });
      }

      return {
        mode: 'sync',
        outputs,
        executionMs: Math.max(1, Date.now() - startedMs),
      };
    }

    if (ctx.subMode === GenerationSubMode.SHADER_CODE) {
      const language =
        ctx.params.modality === Modality.OTHER
          ? ctx.params.shader.language
          : 'GLSL';

      const system = `You are a game shader and gameplay programmer. Return only ${language} source in one fenced block.`;
      const res = await llmAdapter.complete(ctx.provider, {
        model,
        system,
        userParts: [{ type: 'text', text: ctx.compiled.enhancedPrompt }],
        temperature,
        maxOutputTokens: 2400,
        jsonMode: false,
        signal: ctx.signal,
      });

      const code = this.extractFencedCode(res.text);
      const extMap: Record<string, { ext: string; mime: string }> = {
        GLSL: { ext: 'glsl', mime: 'text/x-glsl' },
        HLSL: { ext: 'hlsl', mime: 'text/x-hlsl' },
        GODOT_SHADER: { ext: 'gdshader', mime: 'text/x-gdshader' },
        LUAU: { ext: 'luau', mime: 'text/x-lua' },
        GDSCRIPT: { ext: 'gd', mime: 'text/x-gdscript' },
      };
      const extInfo = extMap[language] ?? { ext: 'glsl', mime: 'text/plain' };

      return {
        mode: 'sync',
        outputs: [
          {
            kind: 'text',
            data: code,
            mimeType: extInfo.mime,
            fileName: `shader.${extInfo.ext}`,
            role: AssetFileRole.PRIMARY,
            batchIndex: 0,
            metadata: {
              language,
              lineCount: code.split(/\r?\n/).length,
            },
          },
        ],
        executionMs: Math.max(1, Date.now() - startedMs),
      };
    }

    // LORE_JSON
    const schemaKind =
      ctx.params.modality === Modality.OTHER
        ? ctx.params.loreJson.schemaKind
        : 'ITEM_TABLE';
    const customSchemaStr =
      ctx.params.modality === Modality.OTHER
        ? ctx.params.loreJson.customSchema
        : null;

    let jsonSchema: Record<string, unknown> =
      BUILTIN_LORE_SCHEMAS[schemaKind] ?? BUILTIN_LORE_SCHEMAS['ITEM_TABLE']!;
    if (customSchemaStr && customSchemaStr.trim().length > 0) {
      try {
        const parsedCustom = JSON.parse(customSchemaStr) as unknown;
        if (typeof parsedCustom === 'object' && parsedCustom !== null) {
          jsonSchema = parsedCustom as Record<string, unknown>;
        }
      } catch {
        // Ignore invalid custom schema string, use built-in fallback
      }
    }

    const system = `You are a game narrative & data designer. Return only valid JSON matching schemaKind=${schemaKind}: ${JSON.stringify(jsonSchema)}`;
    const completion = await llmAdapter.complete(ctx.provider, {
      model,
      system,
      userParts: [{ type: 'text', text: ctx.compiled.enhancedPrompt }],
      temperature,
      maxOutputTokens: 2400,
      jsonMode: true,
      jsonSchema,
      signal: ctx.signal,
    });

    let validJsonText = this.tryNormalizeJson(completion.text);
    if (!validJsonText) {
      const repair = await llmAdapter.complete(ctx.provider, {
        model,
        system:
          'Fix the malformed JSON below and return ONLY valid JSON with no markdown fences.',
        userParts: [{ type: 'text', text: completion.text }],
        temperature: 0,
        maxOutputTokens: 2400,
        jsonMode: true,
        jsonSchema,
        signal: ctx.signal,
      });
      validJsonText = this.tryNormalizeJson(repair.text);
    }

    if (!validJsonText) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'LORE_JSON generation failed JSON.parse after repair round',
      );
    }

    return {
      mode: 'sync',
      outputs: [
        {
          kind: 'text',
          data: validJsonText,
          mimeType: 'application/json',
          fileName: 'lore.json',
          role: AssetFileRole.PRIMARY,
          batchIndex: 0,
          metadata: {
            schemaKind,
            lineCount: validJsonText.split(/\r?\n/).length,
          },
        },
      ],
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }

  private extractFencedCode(raw: string): string {
    const match = /```[a-zA-Z0-9_-]*\s*\r?\n([\s\S]*?)```/.exec(raw);
    if (match && match[1]) {
      return match[1].trim() + '\n';
    }
    return raw.trim() + '\n';
  }

  private tryNormalizeJson(raw: string): string | null {
    const trimmed = raw
      .trim()
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/i, '')
      .trim();
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      return JSON.stringify(parsed, null, 2);
    } catch {
      const start = trimmed.indexOf('{');
      const end = trimmed.lastIndexOf('}');
      if (start >= 0 && end > start) {
        try {
          const parsed = JSON.parse(trimmed.slice(start, end + 1)) as unknown;
          return JSON.stringify(parsed, null, 2);
        } catch {
          return null;
        }
      }
      return null;
    }
  }
}
