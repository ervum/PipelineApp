import {
  ContextFileRef,
  ContextScope,
  estimateTokens,
  StyleDescriptor,
  VaultFileKind,
} from '@forge/shared';
import { Injectable, Optional } from '@nestjs/common';
import { VaultFile } from '@prisma/client';
import sharp from 'sharp';
import { StorageService } from '../storage/storage.service';
import { LlmMessagePart } from './llm/llm-adapter.interface';

export interface ContextCandidate {
  file: VaultFile & { folder: { path: string } };
  reason: 'PINNED' | 'ALWAYS_INCLUDE' | 'SCOPE';
}

export interface ContextBlock {
  fileId: string;
  fileName: string;
  folderPath: string;
  reason: 'PINNED' | 'ALWAYS_INCLUDE' | 'SCOPE';
  truncated: boolean;
  tokens: number;
  envelopeXml: string;
}

export interface AssembleContextOptions {
  attachImages: boolean;
  maxImages: number;
  globalSummary?: string;
  rawPrompt?: string;
  mentionedTerms?: string[];
}

export interface AssembleContextResult {
  blocks: ContextBlock[];
  included: ContextFileRef[];
  dropped: ContextFileRef[];
  imageParts: LlmMessagePart[];
  totalTokens: number;
}

const ENVELOPE_OVERHEAD_TOKENS = 30;
const MIN_TRUNCATION_BUDGET_TOKENS = 300;

function formatScopeProductLabel(scope: ContextScope | string): string {
  if (scope === ContextScope.ICONS_2D) return '2D_ICONS';
  if (scope === ContextScope.ASSETS_3D) return '3D_ASSETS';
  return String(scope);
}

@Injectable()
export class ContextAssemblerService {
  constructor(@Optional() private readonly storage?: StorageService) {}

  async assemble(
    candidates: ContextCandidate[],
    budgetTokens: number,
    opts: AssembleContextOptions,
  ): Promise<AssembleContextResult> {
    // 1. Sort candidates: PINNED (preserve input pin order) -> ALWAYS_INCLUDE (priority desc, updatedAt desc) -> SCOPE (priority desc, updatedAt desc)
    const pinned = candidates.filter((c) => c.reason === 'PINNED');
    const alwaysInclude = candidates
      .filter((c) => c.reason === 'ALWAYS_INCLUDE')
      .sort((a, b) => {
        if (b.file.priority !== a.file.priority) {
          return b.file.priority - a.file.priority;
        }
        return b.file.updatedAt.getTime() - a.file.updatedAt.getTime();
      });
    const scoped = candidates
      .filter((c) => c.reason === 'SCOPE')
      .sort((a, b) => {
        if (opts.rawPrompt && opts.rawPrompt.trim().length > 0) {
          const scoreA =
            a.file.priority +
            this.computeRelevanceScore(
              `${a.file.name}\n${this.renderCandidateBody(a.file)}`,
              opts.rawPrompt,
              opts.mentionedTerms,
            ) *
              35;
          const scoreB =
            b.file.priority +
            this.computeRelevanceScore(
              `${b.file.name}\n${this.renderCandidateBody(b.file)}`,
              opts.rawPrompt,
              opts.mentionedTerms,
            ) *
              35;
          if (Math.abs(scoreB - scoreA) > 0.01) {
            return scoreB - scoreA;
          }
        }
        if (b.file.priority !== a.file.priority) {
          return b.file.priority - a.file.priority;
        }
        return b.file.updatedAt.getTime() - a.file.updatedAt.getTime();
      });

    const ordered = [...pinned, ...alwaysInclude, ...scoped];

    let usedTokens = opts.globalSummary ? estimateTokens(opts.globalSummary) : 0;
    const blocks: ContextBlock[] = [];
    const included: ContextFileRef[] = [];
    const dropped: ContextFileRef[] = [];
    const includedImageCandidates: ContextCandidate[] = [];

    for (const candidate of ordered) {
      const fullBody = this.renderCandidateBody(candidate.file);
      const fullTokens = estimateTokens(fullBody) + ENVELOPE_OVERHEAD_TOKENS;
      const folderPath = candidate.file.folder?.path ?? '/';

      if (usedTokens + fullTokens <= budgetTokens) {
        const envelopeXml = this.buildEnvelopeXml(candidate, fullBody, false);
        blocks.push({
          fileId: candidate.file.id,
          fileName: candidate.file.name,
          folderPath,
          reason: candidate.reason,
          truncated: false,
          tokens: fullTokens,
          envelopeXml,
        });
        included.push({
          fileId: candidate.file.id,
          fileName: candidate.file.name,
          folderPath,
          reason: candidate.reason,
          tokens: fullTokens,
          truncated: false,
        });
        usedTokens += fullTokens;
        if (candidate.file.kind === VaultFileKind.IMAGE) {
          includedImageCandidates.push(candidate);
        }
        continue;
      }

      const remaining = budgetTokens - usedTokens;
      if (
        (candidate.reason === 'PINNED' || candidate.reason === 'ALWAYS_INCLUDE') &&
        remaining >= MIN_TRUNCATION_BUDGET_TOKENS
      ) {
        const targetBodyTokens = Math.max(50, remaining - ENVELOPE_OVERHEAD_TOKENS);
        const maxChars = targetBodyTokens * 4;
        const truncatedBody = this.truncateBody(
          fullBody,
          maxChars,
          opts.rawPrompt,
          opts.mentionedTerms,
        );
        const actualTokens = Math.min(
          remaining,
          estimateTokens(truncatedBody) + ENVELOPE_OVERHEAD_TOKENS,
        );
        const envelopeXml = this.buildEnvelopeXml(candidate, truncatedBody, true);

        blocks.push({
          fileId: candidate.file.id,
          fileName: candidate.file.name,
          folderPath,
          reason: candidate.reason,
          truncated: true,
          tokens: actualTokens,
          envelopeXml,
        });
        included.push({
          fileId: candidate.file.id,
          fileName: candidate.file.name,
          folderPath,
          reason: candidate.reason,
          tokens: actualTokens,
          truncated: true,
        });
        usedTokens += actualTokens;
        if (candidate.file.kind === VaultFileKind.IMAGE) {
          includedImageCandidates.push(candidate);
        }
      } else {
        dropped.push({
          fileId: candidate.file.id,
          fileName: candidate.file.name,
          folderPath,
          reason: candidate.reason,
          tokens: fullTokens,
          truncated: false,
        });
      }
    }

    const imageParts: LlmMessagePart[] = [];
    if (opts.attachImages && opts.maxImages > 0 && this.storage) {
      const selectedImages = includedImageCandidates.slice(0, opts.maxImages);
      for (const imgCand of selectedImages) {
        const key = imgCand.file.thumbnailKey ?? imgCand.file.storageKey;
        if (!key) continue;
        try {
          const rawBuf = await this.storage.getBuffer(key);
          const downscaled = await sharp(rawBuf)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
          imageParts.push({
            type: 'text',
            text: `Reference image for vault_file id="${imgCand.file.id}"`,
          });
          imageParts.push({
            type: 'image',
            mimeType: 'image/jpeg',
            base64: downscaled.toString('base64'),
          });
        } catch {
          // Skip unreadable image binary gracefully
        }
      }
    }

    return {
      blocks,
      included,
      dropped,
      imageParts,
      totalTokens: usedTokens,
    };
  }

  renderCandidateBody(file: VaultFile): string {
    if (
      file.kind === VaultFileKind.MARKDOWN ||
      file.kind === VaultFileKind.TEXT ||
      file.kind === VaultFileKind.JSON
    ) {
      return (file.contentText ?? '').trim();
    }

    if (file.kind === VaultFileKind.IMAGE) {
      const desc =
        file.styleDescriptorText && file.styleDescriptorText.trim().length > 0
          ? file.styleDescriptorText.trim()
          : file.description && file.description.trim().length > 0
            ? file.description.trim()
            : '(reference image, no descriptor yet)';

      const styleJson = file.styleDescriptorJson as StyleDescriptor | null;
      const palette =
        styleJson && Array.isArray(styleJson.paletteHex) && styleJson.paletteHex.length > 0
          ? `\nPalette: ${styleJson.paletteHex.join(' ')}`
          : '';
      return `${desc}${palette}`;
    }

    const parts: string[] = [];
    if (file.description && file.description.trim().length > 0) {
      parts.push(file.description.trim());
    } else {
      parts.push(`(${file.kind} reference file: ${file.name})`);
    }
    if (typeof file.durationMs === 'number' && file.durationMs > 0) {
      parts.push(`Duration: ${(file.durationMs / 1000).toFixed(1)}s (${file.durationMs}ms)`);
    }
    if (typeof file.width === 'number' && typeof file.height === 'number') {
      parts.push(`Dimensions: ${file.width}x${file.height}`);
    }

    const meta =
      typeof file.metadata === 'object' && file.metadata !== null
        ? (file.metadata as Record<string, unknown>)
        : {};

    if (typeof meta['bpm'] === 'number') {
      parts.push(`BPM: ${meta['bpm']}`);
    }
    if (typeof meta['keySignature'] === 'string' && meta['keySignature'].trim()) {
      parts.push(`Key Signature: ${meta['keySignature']}`);
    }
    if (typeof meta['sampleRate'] === 'number') {
      parts.push(`Sample Rate: ${meta['sampleRate']} Hz`);
    }
    if (Array.isArray(meta['stems']) && meta['stems'].length > 0) {
      parts.push(`Stems: ${(meta['stems'] as string[]).join(', ')}`);
    }
    if (typeof meta['transcript'] === 'string' && meta['transcript'].trim()) {
      parts.push(`Transcript: "${meta['transcript'].trim()}"`);
    }
    if (
      typeof meta['triangleCount'] === 'number' ||
      typeof meta['vertexCount'] === 'number'
    ) {
      parts.push(
        `Mesh Geometry: ${meta['triangleCount'] ?? 0} triangles, ${meta['vertexCount'] ?? 0} vertices`,
      );
    }
    if (Array.isArray(meta['boundingBox']) && meta['boundingBox'].length === 3) {
      parts.push(`Bounding Box: ${(meta['boundingBox'] as number[]).join(' x ')}m`);
    }
    if (typeof meta['hasPbr'] === 'boolean') {
      parts.push(`PBR Materials: ${meta['hasPbr'] ? 'yes' : 'no'}`);
    }
    if (typeof meta['fps'] === 'number' && typeof meta['aspectRatio'] === 'string') {
      parts.push(
        `Video Specs: ${meta['fps']}fps, ${meta['aspectRatio']}${
          typeof meta['cameraMotion'] === 'string'
            ? `, motion=${meta['cameraMotion']}`
            : ''
        }`,
      );
    }
    if (typeof meta['enhancedPrompt'] === 'string' && meta['enhancedPrompt'].trim()) {
      parts.push(`Prompt Context: ${meta['enhancedPrompt'].trim()}`);
    }
    if (Array.isArray(meta['tags']) && meta['tags'].length > 0) {
      parts.push(`Tags: ${(meta['tags'] as string[]).join(', ')}`);
    }
    if (typeof meta['notes'] === 'string' && meta['notes'].trim()) {
      parts.push(`Notes: ${meta['notes'].trim()}`);
    }

    return parts.join('\n');
  }

  private buildEnvelopeXml(
    candidate: ContextCandidate,
    body: string,
    truncated: boolean,
  ): string {
    const f = candidate.file;
    const folderPath = f.folder?.path ?? '/';
    const scopesAttr = f.scopes.map((s) => formatScopeProductLabel(s as ContextScope)).join(',');
    return [
      `<vault_file id="${f.id}" name="${f.name}" folder="${folderPath}" scopes="${scopesAttr}" reason="${candidate.reason}" truncated="${truncated ? 'true' : 'false'}">`,
      body,
      `</vault_file>`,
    ].join('\n');
  }

  private truncateBody(
    body: string,
    maxChars: number,
    rawPrompt?: string,
    mentionedTerms?: string[],
  ): string {
    if (body.length <= maxChars) return body;
    const suffix = '\n...[truncated]';
    const budget = Math.max(20, maxChars - suffix.length);

    // Section-aware Markdown truncation when headings and query context exist
    if (
      /^#{1,3}\s+/m.test(body) &&
      ((rawPrompt && rawPrompt.trim().length > 0) ||
        (mentionedTerms && mentionedTerms.length > 0))
    ) {
      const sections = this.splitMarkdownSections(body);
      if (sections.length > 1) {
        const scored = sections.map((sec, index) => ({
          index,
          heading: sec.heading,
          text: sec.fullText,
          score:
            this.computeRelevanceScore(
              sec.fullText,
              rawPrompt ?? '',
              mentionedTerms,
            ) +
            (sec.heading
              ? this.computeRelevanceScore(
                  sec.heading,
                  rawPrompt ?? '',
                  mentionedTerms,
                ) * 1.5
              : 0) +
            (index === 0 ? 0.35 : 0),
        }));

        const byScore = [...scored].sort((a, b) => {
          if (Math.abs(b.score - a.score) > 1e-4) return b.score - a.score;
          return a.index - b.index;
        });

        const selectedIndices = new Set<number>();
        let usedChars = 0;
        const gapMarker = '\n...[section omitted]\n';

        for (const cand of byScore) {
          const needed = cand.text.length + (selectedIndices.size > 0 ? gapMarker.length : 0);
          if (usedChars + needed <= budget) {
            selectedIndices.add(cand.index);
            usedChars += needed;
          } else if (selectedIndices.size === 0) {
            // Even the top-scoring section exceeds budget -> clip it
            const clipped = this.clipPlainText(cand.text, budget);
            return `${clipped}${suffix}`;
          }
        }

        if (selectedIndices.size > 0 && selectedIndices.size < sections.length) {
          const orderedSelected = [...selectedIndices].sort((a, b) => a - b);
          const parts: string[] = [];
          let prevIdx = -1;
          for (const idx of orderedSelected) {
            if (prevIdx !== -1 && idx > prevIdx + 1) {
              parts.push('...[section omitted]');
            }
            parts.push(sections[idx]!.fullText.trim());
            prevIdx = idx;
          }
          return `${parts.join('\n\n')}${suffix}`;
        }
      }
    }

    return `${this.clipPlainText(body, budget)}${suffix}`;
  }

  private clipPlainText(body: string, budget: number): string {
    const sliced = body.slice(0, budget);
    const lastNewline = sliced.lastIndexOf('\n');
    if (lastNewline > budget * 0.6) {
      return sliced.slice(0, lastNewline).trimEnd();
    }
    const lastSpace = sliced.lastIndexOf(' ');
    if (lastSpace > budget * 0.6) {
      return sliced.slice(0, lastSpace).trimEnd();
    }
    return sliced.trimEnd();
  }

  splitMarkdownSections(
    markdown: string,
  ): Array<{ heading: string; fullText: string }> {
    const lines = markdown.split(/\r?\n/);
    const sections: Array<{ heading: string; fullText: string }> = [];
    let currentHeading = '';
    let currentLines: string[] = [];

    for (const line of lines) {
      if (/^#{1,3}\s+/.test(line)) {
        if (currentLines.length > 0) {
          sections.push({
            heading: currentHeading,
            fullText: currentLines.join('\n').trim(),
          });
        }
        currentHeading = line.replace(/^#{1,3}\s+/, '').trim();
        currentLines = [line];
      } else {
        currentLines.push(line);
      }
    }

    if (currentLines.length > 0) {
      const joined = currentLines.join('\n').trim();
      if (joined.length > 0) {
        sections.push({
          heading: currentHeading,
          fullText: joined,
        });
      }
    }

    return sections;
  }

  computeRelevanceScore(
    text: string,
    rawPrompt: string,
    mentionedTerms?: string[],
  ): number {
    const stopWords = new Set([
      'the',
      'and',
      'for',
      'with',
      'that',
      'this',
      'from',
      'into',
      'are',
      'was',
      'were',
      'have',
      'has',
      'had',
      'not',
      'but',
      'you',
      'all',
      'any',
      'can',
      'her',
      'his',
      'its',
      'our',
      'out',
      'who',
      'generate',
      'create',
      'make',
      'asset',
    ]);

    const tokenize = (input: string): string[] =>
      input
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length >= 3 && !stopWords.has(w));

    const stem = (word: string): string =>
      word.replace(/(ing|ed|es|s|ly|tion|ment)$/i, '');

    const queryTokens = [
      ...tokenize(rawPrompt),
      ...(mentionedTerms ?? []).flatMap((t) => tokenize(t)),
    ];
    if (queryTokens.length === 0) return 0;

    const docTokens = tokenize(text);
    if (docTokens.length === 0) return 0;

    const docTokenSet = new Set(docTokens);
    const docStemSet = new Set(docTokens.map(stem));

    let hits = 0;
    for (const qt of queryTokens) {
      if (docTokenSet.has(qt)) {
        hits += 1.0;
      } else if (docStemSet.has(stem(qt))) {
        hits += 0.75;
      } else {
        // Check character trigram Jaccard similarity for partial/compound matches
        const qTri = this.charTrigrams(qt);
        let bestTri = 0;
        for (const dt of docTokenSet) {
          if (Math.abs(dt.length - qt.length) > 5) continue;
          const sim = this.trigramJaccard(qTri, this.charTrigrams(dt));
          if (sim > bestTri) bestTri = sim;
        }
        if (bestTri >= 0.45) {
          hits += bestTri * 0.6;
        }
      }
    }

    return Math.min(1, hits / Math.max(1, queryTokens.length));
  }

  private charTrigrams(word: string): Set<string> {
    const padded = `_${word}_`;
    const set = new Set<string>();
    for (let i = 0; i <= padded.length - 3; i++) {
      set.add(padded.slice(i, i + 3));
    }
    return set;
  }

  private trigramJaccard(a: Set<string>, b: Set<string>): number {
    if (a.size === 0 || b.size === 0) return 0;
    let inter = 0;
    for (const x of a) {
      if (b.has(x)) inter++;
    }
    return inter / (a.size + b.size - inter);
  }
}
