import {
  CompiledPrompt,
  estimateTokens,
  Modality,
  ProviderKind,
  StyleDescriptor,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { sleep } from '../../common/utils/sleep';
import { ProviderRuntimeConfig } from '../../providers/providers.service';
import { synthesizeLoreJson, synthesizeShaderCode } from '../../synth/text.synth';
import { BaseLlmAdapter, LlmRequest, LlmStreamEvent } from './llm-adapter.interface';

const MODALITY_LEAD: Record<Modality, string> = {
  [Modality.ICONS_2D]:
    'game item icon, centered die-cut subject, bold readable silhouette, soft rim light',
  [Modality.ASSETS_3D]:
    'isolated game-ready 3D asset, clean watertight silhouette, physically-based materials, neutral studio lighting',
  [Modality.IMAGES]:
    'high-impact stylized game illustration, crisp value grouping, atmospheric lighting, cohesive color script',
  [Modality.VIDEO]:
    'cinematic game video sequence, smooth temporal camera trajectory, coherent lighting continuity, vivid atmospheric motion',
  [Modality.LORE]:
    'canonical in-world game narrative, evocative literary prose, strict adherence to world history, factions, and material culture',
  [Modality.MUSIC]:
    'adaptive game score cue, clear rhythmic pulse, balanced stereo orchestration, seamless harmonic cadence',
  [Modality.VOICES]:
    'in-character studio voice performance, clean close-mic vocal presence, expressive pacing',
  [Modality.SFX]:
    'clean close-mic game foley and sound effect, crisp transient attack, controlled decay tail',
  [Modality.OTHER]:
    'production-ready technical game asset, consistent framing and deterministic structure',
};

const STOP_WORDS = new Set([
  'a',
  'an',
  'the',
  'of',
  'for',
  'with',
  'in',
  'on',
  'at',
  'to',
  'and',
  'or',
  'create',
  'generate',
  'make',
  'render',
  'design',
  'icon',
  'image',
  'model',
  'sound',
  'track',
  'voice',
]);

interface ParsedVaultFileBlock {
  id: string;
  name: string;
  folder: string;
  scopes: string;
  reason: string;
  truncated: string;
  body: string;
}

@Injectable()
export class DemoLlmAdapter extends BaseLlmAdapter {
  readonly kind = ProviderKind.DEMO;

  async *stream(_cfg: ProviderRuntimeConfig, req: LlmRequest): AsyncGenerator<LlmStreamEvent> {
    const userText = req.userParts
      .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
      .map((p) => p.text)
      .join('\n\n');
    const imageParts = req.userParts.filter(
      (p): p is { type: 'image'; mimeType: string; base64: string } => p.type === 'image',
    );

    let fullOutput: string;
    if (imageParts.length > 0 && /art-direction analyst/i.test(req.system)) {
      fullOutput = await this.buildVisionOutput(imageParts[0]!.base64);
    } else if (/Return only .* source in one fenced block/i.test(req.system)) {
      fullOutput = this.buildCodeOutput(req.system, userText);
    } else if (/lore_json_generator/i.test(req.system)) {
      fullOutput = this.buildLoreOutput(userText);
    } else {
      const compiled = this.buildCompiledPrompt(req.system, userText);
      fullOutput = JSON.stringify(compiled, null, 2);
    }

    const chunkSize = 24;
    for (let offset = 0; offset < fullOutput.length; offset += chunkSize) {
      await sleep(18, req.signal);
      yield {
        type: 'delta',
        text: fullOutput.slice(offset, offset + chunkSize),
      };
    }

    const inputTokens = estimateTokens(req.system + '\n' + userText);
    const outputTokens = estimateTokens(fullOutput);
    yield {
      type: 'done',
      usage: { inputTokens, outputTokens },
    };
  }

  /**
   * Deterministic offline compiler (§4.6.6).
   */
  private buildCompiledPrompt(system: string, userMessage: string): CompiledPrompt {
    const userRequest =
      this.extractXmlTag(userMessage, 'user_request')?.trim() ||
      userMessage.trim().slice(0, 300) ||
      'Stylized game asset';

    const userParamsRaw = this.extractXmlTag(userMessage, 'user_params');
    let parsedParams: Record<string, unknown> = {};
    if (userParamsRaw) {
      try {
        parsedParams = JSON.parse(userParamsRaw) as Record<string, unknown>;
      } catch {
        parsedParams = {};
      }
    }

    const modality = this.resolveModality(parsedParams, system);
    const vaultBlocks = this.parseVaultFileBlocks(userMessage);
    const projectSummary = this.extractXmlTag(userMessage, 'project_summary') ?? '';

    // 1. Extract first 6 unique #RRGGBB across blocks (PINNED first, then ALWAYS_INCLUDE, then SCOPE, then projectSummary)
    const palette: string[] = [];
    const seenHex = new Set<string>();
    const addHexesFrom = (text: string): void => {
      const matches = text.match(/#[0-9A-Fa-f]{6}\b/g) ?? [];
      for (const m of matches) {
        const upper = m.toUpperCase();
        if (!seenHex.has(upper) && palette.length < 6) {
          seenHex.add(upper);
          palette.push(upper);
        }
      }
    };
    for (const block of vaultBlocks) {
      addHexesFrom(block.body);
    }
    addHexesFrom(projectSummary);

    // 2. styleClauses = first sentence of each vault_file body whose name matches /art bible|style|guide|direction|standards/i (max 3, <= 160 chars each)
    const styleClauses: string[] = [];
    for (const block of vaultBlocks) {
      if (styleClauses.length >= 3) break;
      if (/art bible|style|guide|direction|standards/i.test(block.name)) {
        const sentence = this.extractFirstMeaningfulSentence(block.body);
        if (sentence) {
          styleClauses.push(sentence.slice(0, 160));
        }
      }
    }

    // 3. Hard constraint lines from system prompt
    const hardConstraintLines = this.extractSectionLines(system, '# HARD CONSTRAINTS').map(
      (line) => line.replace(/^-\s*/, '').trim(),
    );

    // 4. Max prompt chars from # COMPILER RULES
    const maxCharsMatch = /Keep enhancedPrompt\s*[≤<=]+\s*(\d+)\s*characters/i.exec(system);
    const maxPromptChars = maxCharsMatch ? Number(maxCharsMatch[1]) : 2000;

    // 5. Build enhancedPrompt
    const transcriptTag = this.extractXmlTag(userMessage, 'transcript')?.trim();
    let enhancedPrompt: string;
    if (modality === Modality.VOICES && transcriptTag) {
      enhancedPrompt = transcriptTag.slice(0, maxPromptChars);
    } else {
      const segments = [
        userRequest.replace(/\.+$/, ''),
        MODALITY_LEAD[modality],
        ...styleClauses.map((s) => s.replace(/\.+$/, '')),
        palette.length > 0 ? `strict palette ${palette.join(', ')}` : '',
        ...hardConstraintLines.map((s) => s.replace(/\.+$/, '')),
      ].filter((s) => s.trim().length > 0);
      enhancedPrompt = this.truncateAtWordBoundary(segments.join('. '), maxPromptChars);
    }

    // 6. negativePrompt from # DEFAULT NEGATIVE PROMPT
    const negativeLines = this.extractSectionLines(system, '# DEFAULT NEGATIVE PROMPT');
    const negativePrompt = negativeLines.join(', ').trim();

    // 7. recommendedParams = each ParamSpec default from # ALLOWED PARAMETERS
    const recommendedParams = this.parseAllowedParamDefaults(system);
    if (modality === Modality.VOICES && styleClauses.length > 0) {
      recommendedParams['instructions'] = styleClauses.join(' ').slice(0, 220);
    }

    // 8. contextSourcesUsed = every vault_file id with reasoningNote "Applied {reason} context from {folder}/{name}"
    const contextSourcesUsed = vaultBlocks.map((b) => {
      const folderClean = b.folder === '/' ? '' : b.folder;
      const note = `Applied ${b.reason} context from ${folderClean}/${b.name}`.slice(0, 200);
      return {
        fileId: b.id,
        fileName: b.name,
        reasoningNote: note,
      };
    });

    // 9. assetTitle = Title Case of the first 4 meaningful words of the request
    const assetTitle = this.buildAssetTitle(userRequest);

    return {
      assetTitle,
      enhancedPrompt,
      negativePrompt,
      recommendedParams,
      contextSourcesUsed,
      warnings: [],
    };
  }

  /**
   * Demo vision analysis (§6.3): decode image with sharp, resize to 64x64,
   * median-cut quantize to 6 colours -> paletteHex; average luminance -> lighting;
   * saturation mean -> rendering; compose styleDescriptorText.
   */
  private async buildVisionOutput(base64: string): Promise<string> {
    const imgBuf = Buffer.from(base64, 'base64');
    const { data, info } = await sharp(imgBuf)
      .resize(64, 64, { fit: 'cover' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const pixels: Array<[number, number, number]> = [];
    let lumSum = 0;
    let satSum = 0;
    const count = info.width * info.height;

    for (let i = 0; i < data.length; i += info.channels) {
      const r = data[i] ?? 0;
      const g = data[i + 1] ?? 0;
      const b = data[i + 2] ?? 0;
      pixels.push([r, g, b]);

      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumSum += lum;

      const maxC = Math.max(r, g, b) / 255;
      const minC = Math.min(r, g, b) / 255;
      const l = (maxC + minC) / 2;
      const sat =
        maxC === minC
          ? 0
          : l > 0.5
            ? (maxC - minC) / (2 - maxC - minC)
            : (maxC - minC) / (maxC + minC);
      satSum += sat;
    }

    const avgLum = count > 0 ? lumSum / count : 128;
    const avgSat = count > 0 ? satSum / count : 0.5;
    const paletteHex = this.medianCutQuantize(pixels, 6);

    const lighting =
      avgLum >= 120
        ? 'high-key soft light with luminous highlights and gentle rim separation'
        : 'low-key dramatic light with deep night shadows and high-contrast focal rim glow';

    const rendering =
      avgSat >= 0.35
        ? 'vivid painterly cel-shading with two-tone shadow grouping and crisp value transitions'
        : 'muted desaturated atmospheric rendering with soft tonal gradients';

    const styleDescriptorText =
      `Stylized game art reference featuring ${rendering} and ${lighting}. ` +
      `Dominant palette anchors on ${paletteHex.join(', ')}, pairing deep shadow masses with concentrated emissive accents. ` +
      `Silhouettes maintain chunky, game-readable proportions (1.2x focal bevels) with clean value contrast at edges and zero photographic noise. ` +
      `Surface materials separate clearly into polished metallic trims, faceted emissive cores, and matte base textiles suitable for production game assets.`;

    const descriptor: StyleDescriptor = {
      paletteHex,
      lighting,
      rendering,
      linework: 'Crisp value-defined edges with bold outer silhouette separation',
      proportions: 'Stylized 1.2x heroic game proportions for immediate thumbnail legibility',
      materials: 'Polished metallic filigree, faceted emissive crystal, matte cloth and stone',
      composition: 'Centered focal hierarchy with clean negative space and rim-lit subject',
      mood: avgLum >= 120 ? 'Radiant, heroic, high-energy' : 'Atmospheric, mysterious, mythic',
      doNot: ['photographic noise', 'muddy midtones', 'text or watermarks', 'cluttered background'],
    };

    return JSON.stringify({ styleDescriptorText, descriptor }, null, 2);
  }

  private medianCutQuantize(
    pixels: Array<[number, number, number]>,
    targetCount: number,
  ): string[] {
    if (pixels.length === 0) {
      return ['#1B1446', '#7C3AED', '#F5C451', '#3CD3F0', '#FF6B5A', '#F4EFE6'];
    }

    const buckets: Array<Array<[number, number, number]>> = [pixels];

    while (buckets.length < targetCount) {
      let splitIdx = -1;
      let maxRange = -1;
      let splitChannel: 0 | 1 | 2 = 0;

      for (let i = 0; i < buckets.length; i++) {
        const b = buckets[i]!;
        if (b.length < 2) continue;
        let minR = 255,
          maxR = 0,
          minG = 255,
          maxG = 0,
          minB = 255,
          maxB = 0;
        for (const [r, g, bl] of b) {
          if (r < minR) minR = r;
          if (r > maxR) maxR = r;
          if (g < minG) minG = g;
          if (g > maxG) maxG = g;
          if (bl < minB) minB = bl;
          if (bl > maxB) maxB = bl;
        }
        const rRange = maxR - minR;
        const gRange = maxG - minG;
        const bRange = maxB - minB;
        const best = Math.max(rRange, gRange, bRange);
        if (best > maxRange) {
          maxRange = best;
          splitIdx = i;
          splitChannel = rRange >= gRange && rRange >= bRange ? 0 : gRange >= bRange ? 1 : 2;
        }
      }

      if (splitIdx === -1 || maxRange === 0) break;
      const target = buckets[splitIdx]!;
      const sorted = [...target].sort((a, b) => a[splitChannel] - b[splitChannel]);
      const mid = Math.floor(sorted.length / 2);
      buckets.splice(splitIdx, 1, sorted.slice(0, mid), sorted.slice(mid));
    }

    const hexes: string[] = [];
    const seen = new Set<string>();
    for (const b of buckets) {
      if (b.length === 0) continue;
      let rSum = 0,
        gSum = 0,
        bSum = 0;
      for (const [r, g, bl] of b) {
        rSum += r;
        gSum += g;
        bSum += bl;
      }
      const rAvg = Math.round(rSum / b.length);
      const gAvg = Math.round(gSum / b.length);
      const bAvg = Math.round(bSum / b.length);
      const hex = `#${rAvg.toString(16).padStart(2, '0')}${gAvg.toString(16).padStart(2, '0')}${bAvg.toString(16).padStart(2, '0')}`.toUpperCase();
      if (!seen.has(hex)) {
        seen.add(hex);
        hexes.push(hex);
      }
    }

    const fallbacks = ['#1B1446', '#7C3AED', '#F5C451', '#3CD3F0', '#FF6B5A', '#F4EFE6'];
    for (const fb of fallbacks) {
      if (hexes.length >= targetCount) break;
      if (!seen.has(fb)) {
        seen.add(fb);
        hexes.push(fb);
      }
    }

    return hexes.slice(0, targetCount);
  }

  private buildCodeOutput(system: string, userText: string): string {
    const langMatch = /Return only (\w+) source/i.exec(system);
    const rawLang = langMatch?.[1]?.toUpperCase() ?? 'LUAU';
    const language: 'LUAU' | 'GDSCRIPT' | 'GODOT_SHADER' | 'HLSL' | 'GLSL' =
      rawLang === 'GDSHADER' || rawLang === 'GODOT_SHADER'
        ? 'GODOT_SHADER'
        : rawLang === 'GDSCRIPT'
          ? 'GDSCRIPT'
          : rawLang === 'HLSL'
            ? 'HLSL'
            : rawLang === 'GLSL'
              ? 'GLSL'
              : 'LUAU';
    const res = synthesizeShaderCode({
      seed: 20261022,
      language,
      targetEngine: language === 'LUAU' ? 'ROBLOX' : 'GODOT',
      prompt: userText.slice(0, 300),
    });
    return `\`\`\`${res.extension}\n${res.code}\n\`\`\``;
  }

  private buildLoreOutput(userText: string): string {
    const res = synthesizeLoreJson({
      seed: 20261022,
      schemaKind: 'ITEM_TABLE',
      entryCount: 4,
      prompt: userText.slice(0, 300),
    });
    return res.jsonText;
  }

  private extractXmlTag(text: string, tag: string): string | null {
    const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const m = re.exec(text);
    return m?.[1] ?? null;
  }

  private parseVaultFileBlocks(text: string): ParsedVaultFileBlock[] {
    const blocks: ParsedVaultFileBlock[] = [];
    const re = /<vault_file\s+([^>]+)>([\s\S]*?)<\/vault_file>/gi;
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      const attrs = match[1] ?? '';
      const body = (match[2] ?? '').trim();
      const getAttr = (name: string): string => {
        const m = new RegExp(`${name}="([^"]*)"`, 'i').exec(attrs);
        return m?.[1] ?? '';
      };
      const id = getAttr('id');
      if (id) {
        blocks.push({
          id,
          name: getAttr('name') || 'Document.md',
          folder: getAttr('folder') || '/',
          scopes: getAttr('scopes'),
          reason: getAttr('reason') || 'SCOPE',
          truncated: getAttr('truncated') || 'false',
          body,
        });
      }
    }
    return blocks;
  }

  private extractFirstMeaningfulSentence(body: string): string {
    const lines = body
      .split(/\r?\n/)
      .map((l) => l.replace(/^#+\s*/, '').replace(/^[-*]\s*/, '').trim())
      .filter((l) => l.length > 20 && !l.startsWith('|'));
    const candidate = lines[0] ?? '';
    const firstSentence = candidate.split(/(?<=[.!?])\s+/)[0] ?? candidate;
    return firstSentence.trim();
  }

  private extractSectionLines(system: string, heading: string): string[] {
    const idx = system.indexOf(heading);
    if (idx === -1) return [];
    const lineEndIdx = system.indexOf('\n', idx);
    if (lineEndIdx === -1) return [];
    const after = system.slice(lineEndIdx + 1);
    const nextHeadingIdx = after.search(/\n# [A-Z]/);
    const sectionBody = nextHeadingIdx === -1 ? after : after.slice(0, nextHeadingIdx);
    return sectionBody
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
  }

  private parseAllowedParamDefaults(
    system: string,
  ): Record<string, string | number | boolean | null | string[]> {
    const lines = this.extractSectionLines(system, '# ALLOWED PARAMETERS');
    const out: Record<string, string | number | boolean | null | string[]> = {};
    for (const line of lines) {
      const m = /^-\s*([a-zA-Z0-9_]+)\s*\(([^)]+)\)\s*default=([^:]+):/.exec(line);
      if (!m) continue;
      const key = m[1]!;
      const typeInfo = m[2]!;
      const rawDefault = m[3]!.trim();
      if (rawDefault === 'null') {
        out[key] = null;
      } else if (typeInfo.startsWith('boolean') || rawDefault === 'true' || rawDefault === 'false') {
        out[key] = rawDefault === 'true';
      } else if (typeInfo.startsWith('number') || typeInfo.startsWith('integer')) {
        const num = Number(rawDefault);
        if (Number.isFinite(num)) {
          out[key] = num;
        }
      } else {
        out[key] = rawDefault.replace(/^["']|["']$/g, '');
      }
    }
    return out;
  }

  private resolveModality(params: Record<string, unknown>, system: string): Modality {
    const pMod = params['modality'];
    if (
      typeof pMod === 'string' &&
      Object.values(Modality).includes(pMod as Modality)
    ) {
      return pMod as Modality;
    }
    if (/2D Icons/i.test(system)) return Modality.ICONS_2D;
    if (/3D Assets/i.test(system)) return Modality.ASSETS_3D;
    if (/Music/i.test(system)) return Modality.MUSIC;
    if (/Voices/i.test(system)) return Modality.VOICES;
    if (/Sound Effects|SFX/i.test(system)) return Modality.SFX;
    if (/Technical|Spritesheets/i.test(system)) return Modality.OTHER;
    return Modality.IMAGES;
  }

  private truncateAtWordBoundary(text: string, maxChars: number): string {
    if (text.length <= maxChars) return text;
    const sliced = text.slice(0, maxChars);
    const lastSpace = sliced.lastIndexOf(' ');
    return (lastSpace > maxChars * 0.7 ? sliced.slice(0, lastSpace) : sliced).trim();
  }

  private buildAssetTitle(request: string): string {
    const cleaned = request
      .replace(/@[a-zA-Z0-9_./-]+/g, '')
      .replace(/\b[\w-]+\.(md|txt|json|png|jpg|jpeg|webp|wav|mp3|glb|obj|fbx)\b/gi, '')
      .replace(/[^a-zA-Z0-9\s'-]/g, ' ')
      .trim();
    const words = cleaned
      .split(/\s+/)
      .filter((w) => w.length > 1 && !STOP_WORDS.has(w.toLowerCase()));
    const chosen = (words.length > 0 ? words : cleaned.split(/\s+/)).slice(0, 4);
    const title = chosen
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ')
      .trim();
    return (title || 'Forged Studio Asset').slice(0, 80);
  }
}
