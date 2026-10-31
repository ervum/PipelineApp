import {
  AdapterDescriptor,
  CompiledPrompt,
  CompiledPromptSchema,
  ErrorCode,
  ParamSpec,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error';

export const COMPILED_PROMPT_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  required: [
    'assetTitle',
    'enhancedPrompt',
    'negativePrompt',
    'recommendedParams',
    'contextSourcesUsed',
    'warnings',
  ],
  properties: {
    assetTitle: {
      type: 'string',
      description: 'Short in-world display name following project naming conventions (1-80 chars)',
    },
    enhancedPrompt: {
      type: 'string',
      description: 'Production-ready generation prompt encoding vault rules, hex palette, and style',
    },
    negativePrompt: {
      type: 'string',
      description: 'Comma-separated concrete exclusions',
    },
    recommendedParams: {
      type: 'object',
      description: 'Recommended generator parameters from ALLOWED PARAMETERS',
    },
    contextSourcesUsed: {
      type: 'array',
      items: {
        type: 'object',
        required: ['fileId', 'fileName', 'reasoningNote'],
        properties: {
          fileId: { type: 'string' },
          fileName: { type: 'string' },
          reasoningNote: { type: 'string' },
        },
      },
    },
    warnings: {
      type: 'array',
      items: { type: 'string' },
    },
  },
};

export interface CompileParseContext {
  availableFiles: Array<{ id: string; name: string }>;
  descriptor: AdapterDescriptor;
  defaultNegativePrompt: string;
}

/**
 * Extracts the first top-level balanced `{ ... }` JSON object from raw LLM output,
 * stripping UTF-8 BOM and markdown code fences, and respecting string literals / escapes.
 */
export function extractBalancedJsonObject(raw: string): string {
  const withoutBom = raw.replace(/^\uFEFF/, '').trim();
  const unfenced = withoutBom
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const startIdx = unfenced.indexOf('{');
  if (startIdx === -1) {
    throw new DomainError(
      ErrorCode.MIDDLEMAN_PARSE_FAILED,
      502,
      'No JSON object opening brace found in LLM output',
    );
  }

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = startIdx; i < unfenced.length; i++) {
    const ch = unfenced[i]!;
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return unfenced.slice(startIdx, i + 1);
      }
    }
  }

  throw new DomainError(
    ErrorCode.MIDDLEMAN_PARSE_FAILED,
    502,
    'Unbalanced JSON braces in LLM output',
  );
}

/**
 * Light JSON repair for trailing commas before `}` / `]` and smart quotes (§4.6.5).
 */
export function lightRepairJson(candidate: string): string {
  return candidate
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
}

export function extractAndParseJson(raw: string): unknown {
  const slice = extractBalancedJsonObject(raw);
  try {
    return JSON.parse(slice);
  } catch {
    const repaired = lightRepairJson(slice);
    try {
      return JSON.parse(repaired);
    } catch (err) {
      throw new DomainError(
        ErrorCode.MIDDLEMAN_PARSE_FAILED,
        502,
        `Malformed JSON after light repair: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

@Injectable()
export class CompiledOutputParser {
  parse(rawOutput: string, ctx: CompileParseContext): CompiledPrompt {
    const parsedObj = extractAndParseJson(rawOutput);

    // Pre-coerce or pre-clean raw fields so minor numeric/string overshoots can be handled cleanly
    if (typeof parsedObj === 'object' && parsedObj !== null && !Array.isArray(parsedObj)) {
      const rec = parsedObj as Record<string, unknown>;
      if (typeof rec['assetTitle'] === 'string' && rec['assetTitle'].length > 80) {
        rec['assetTitle'] = rec['assetTitle'].slice(0, 80).trim();
      }
      if (Array.isArray(rec['contextSourcesUsed'])) {
        rec['contextSourcesUsed'] = rec['contextSourcesUsed'].map((item) => {
          if (typeof item === 'object' && item !== null) {
            const src = item as Record<string, unknown>;
            return {
              fileId: String(src['fileId'] ?? ''),
              fileName: String(src['fileName'] ?? ''),
              reasoningNote: String(src['reasoningNote'] ?? '').slice(0, 200),
            };
          }
          return item;
        });
      }
    }

    const zodResult = CompiledPromptSchema.safeParse(parsedObj);
    if (!zodResult.success) {
      throw new DomainError(
        ErrorCode.MIDDLEMAN_PARSE_FAILED,
        502,
        `Compiled output failed schema validation: ${zodResult.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`,
        zodResult.error.issues,
      );
    }

    const data = zodResult.data;
    const warnings: string[] = [...data.warnings];
    const addWarning = (w: string): void => {
      const clipped = w.slice(0, 280);
      if (!warnings.includes(clipped) && warnings.length < 10) {
        warnings.push(clipped);
      }
    };

    // 1. Post-validate contextSourcesUsed: drop unknown fileIds, fix mismatched fileName
    const fileMap = new Map<string, string>();
    for (const f of ctx.availableFiles) {
      fileMap.set(f.id, f.name);
    }
    const seenFileIds = new Set<string>();
    const validSources: CompiledPrompt['contextSourcesUsed'] = [];
    for (const src of data.contextSourcesUsed) {
      const realName = fileMap.get(src.fileId);
      if (!realName) {
        addWarning(`Dropped unknown context fileId "${src.fileId}"`);
        continue;
      }
      if (seenFileIds.has(src.fileId)) {
        continue;
      }
      seenFileIds.add(src.fileId);
      validSources.push({
        fileId: src.fileId,
        fileName: realName,
        reasoningNote: src.reasoningNote.slice(0, 200),
      });
    }

    // 2. Post-validate recommendedParams against descriptor.paramSpecs
    const specMap = new Map<string, ParamSpec>();
    for (const spec of ctx.descriptor.paramSpecs) {
      specMap.set(spec.key, spec);
    }

    const cleanedParams: CompiledPrompt['recommendedParams'] = {};
    for (const [key, rawVal] of Object.entries(data.recommendedParams)) {
      const spec = specMap.get(key);
      if (!spec) {
        addWarning(`Dropped unsupported parameter "${key}"`);
        continue;
      }
      if (rawVal === null) {
        cleanedParams[key] = null;
        continue;
      }

      if (spec.type === 'number' || spec.type === 'integer') {
        let num = typeof rawVal === 'number' ? rawVal : Number(rawVal);
        if (!Number.isFinite(num)) {
          addWarning(`Dropped non-numeric value for parameter "${key}"`);
          continue;
        }
        if (spec.min !== undefined && num < spec.min) {
          addWarning(`Clamped parameter "${key}" from ${num} to min ${spec.min}`);
          num = spec.min;
        }
        if (spec.max !== undefined && num > spec.max) {
          addWarning(`Clamped parameter "${key}" from ${num} to max ${spec.max}`);
          num = spec.max;
        }
        if (spec.type === 'integer') {
          num = Math.round(num);
        }
        cleanedParams[key] = num;
      } else if (spec.type === 'boolean') {
        if (typeof rawVal === 'boolean') {
          cleanedParams[key] = rawVal;
        } else if (rawVal === 'true' || rawVal === 'false') {
          cleanedParams[key] = rawVal === 'true';
        } else {
          addWarning(`Dropped invalid boolean value for parameter "${key}"`);
        }
      } else if (spec.type === 'enum') {
        const strVal = String(rawVal);
        const allowed = spec.options?.some((opt) => opt.value === strVal) ?? false;
        if (!allowed) {
          addWarning(`Dropped invalid enum value "${strVal}" for parameter "${key}"`);
          continue;
        }
        cleanedParams[key] = strVal;
      } else if (spec.type === 'string') {
        cleanedParams[key] = String(rawVal);
      }
    }

    // 3. Merge template defaultNegativePrompt terms into negativePrompt (case-insensitive dedupe, comma-joined)
    const mergedNegative = this.mergeNegativePrompts(
      data.negativePrompt,
      ctx.defaultNegativePrompt,
    );

    // 4. Truncate enhancedPrompt to descriptor.maxPromptChars at a word boundary
    let enhancedPrompt = data.enhancedPrompt;
    const maxChars = ctx.descriptor.maxPromptChars;
    if (maxChars > 0 && enhancedPrompt.length > maxChars) {
      enhancedPrompt = this.truncateAtWordBoundary(enhancedPrompt, maxChars);
      addWarning(`Truncated enhancedPrompt to ${maxChars} characters`);
    }

    return {
      assetTitle: data.assetTitle,
      enhancedPrompt,
      negativePrompt: mergedNegative,
      recommendedParams: cleanedParams,
      contextSourcesUsed: validSources,
      warnings: warnings.slice(0, 10),
    };
  }

  private mergeNegativePrompts(llmNegative: string, defaultNegative: string): string {
    const terms: string[] = [];
    const seenLower = new Set<string>();

    const addTerms = (input: string): void => {
      for (const rawTerm of input.split(',')) {
        const t = rawTerm.trim();
        if (!t) continue;
        const lower = t.toLowerCase();
        if (!seenLower.has(lower)) {
          seenLower.add(lower);
          terms.push(t);
        }
      }
    };

    addTerms(llmNegative);
    addTerms(defaultNegative);

    return terms.join(', ').slice(0, 2000);
  }

  private truncateAtWordBoundary(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const slice = text.slice(0, maxChars);
    const lastSpace = slice.lastIndexOf(' ');
    if (lastSpace > Math.floor(maxChars * 0.6)) {
      return slice.slice(0, lastSpace).trim();
    }
    return slice.trim();
  }
}
