import {
  ContextScope,
  ErrorCode,
  extractMentions,
  Modality,
  normalizeForMention,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error';
import { ContextCandidate } from '../middleman/context-assembler.service';
import { PrismaService } from '../prisma/prisma.service';

export interface CollectCandidatesResult {
  candidates: ContextCandidate[];
  warnings: string[];
}

@Injectable()
export class VaultContextService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolves @mentions and collects PINNED, ALWAYS_INCLUDE, and modality-scoped Vault files (§4.4).
   */
  async collectCandidates(
    projectId: string,
    modality: Modality,
    explicitPinnedIds: string[],
    rawPrompt: string,
  ): Promise<CollectCandidatesResult> {
    const allProjectFiles = await this.prisma.vaultFile.findMany({
      where: { projectId },
      include: { folder: { select: { path: true } } },
    });

    const byId = new Map(allProjectFiles.map((f) => [f.id, f]));

    // Validate explicitPinnedIds belong to projectId
    for (const pid of explicitPinnedIds) {
      if (!byId.has(pid)) {
        throw new DomainError(
          ErrorCode.VALIDATION_FAILED,
          400,
          `Pinned vault file "${pid}" does not belong to project "${projectId}"`,
        );
      }
    }

    const warnings: string[] = [];
    const mentionTokens = extractMentions(rawPrompt);
    const resolvedMentionIds: string[] = [];

    for (const token of mentionTokens) {
      const matched = allProjectFiles.find((file) => {
        const normName = normalizeForMention(file.name);
        if (normName === token) return true;
        const withoutExt = file.name.replace(/\.[^.]+$/, '');
        if (normalizeForMention(withoutExt) === token) return true;
        const fullPath =
          file.folder.path === '/' ? `/${file.name}` : `${file.folder.path}/${file.name}`;
        if (normalizeForMention(fullPath).endsWith(token)) return true;
        return false;
      });

      if (matched) {
        if (!resolvedMentionIds.includes(matched.id)) {
          resolvedMentionIds.push(matched.id);
        }
      } else {
        warnings.push(`Unresolved @mention: @${token}`);
      }
    }

    const pinnedIds: string[] = [];
    const pinnedSet = new Set<string>();
    for (const id of [...explicitPinnedIds, ...resolvedMentionIds]) {
      if (!pinnedSet.has(id)) {
        pinnedSet.add(id);
        pinnedIds.push(id);
      }
    }

    const candidates: ContextCandidate[] = [];

    // 1. PINNED in pin order
    for (const id of pinnedIds) {
      const file = byId.get(id);
      if (file) {
        candidates.push({ file, reason: 'PINNED' });
      }
    }

    // 2. Scoped files (ALWAYS_INCLUDE or matching modality) not already pinned
    const modalityScope = modality as unknown as ContextScope;
    for (const file of allProjectFiles) {
      if (pinnedSet.has(file.id)) continue;
      const scopes = file.scopes as ContextScope[];
      if (scopes.includes(ContextScope.ALWAYS_INCLUDE)) {
        candidates.push({ file, reason: 'ALWAYS_INCLUDE' });
      } else if (scopes.includes(modalityScope)) {
        candidates.push({ file, reason: 'SCOPE' });
      }
    }

    return { candidates, warnings };
  }
}
