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
        const truncatedBody = this.truncateBody(fullBody, maxChars);
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

  private truncateBody(body: string, maxChars: number): string {
    if (body.length <= maxChars) return body;
    const suffix = '\n...[truncated]';
    const budget = Math.max(20, maxChars - suffix.length);
    const sliced = body.slice(0, budget);
    const lastNewline = sliced.lastIndexOf('\n');
    if (lastNewline > budget * 0.6) {
      return `${sliced.slice(0, lastNewline).trimEnd()}${suffix}`;
    }
    const lastSpace = sliced.lastIndexOf(' ');
    if (lastSpace > budget * 0.6) {
      return `${sliced.slice(0, lastSpace).trimEnd()}${suffix}`;
    }
    return `${sliced.trimEnd()}${suffix}`;
  }
}
