import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CompiledPrompt, ContextFileRef } from '@forge/shared';
import { IconComponent } from '../../../../ui/icon/icon.component';

export interface EnrichedContextSource {
  fileId: string;
  fileName: string;
  folderPath: string | null;
  reason: 'PINNED' | 'ALWAYS_INCLUDE' | 'SCOPE' | 'COMPILED';
  tokens: number | null;
  truncated: boolean;
  reasoningNote: string | null;
}

@Component({
  selector: 'fs-context-sources-list',
  standalone: true,
  imports: [RouterLink, IconComponent],
  templateUrl: './context-sources-list.component.html',
  styleUrl: './context-sources-list.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContextSourcesListComponent {
  readonly contextFiles = input<ReadonlyArray<ContextFileRef>>([]);
  readonly usedSources = input<CompiledPrompt['contextSourcesUsed']>([]);
  readonly droppedFiles = input<ReadonlyArray<ContextFileRef>>([]);

  readonly enrichedSources = computed<EnrichedContextSource[]>(() => {
    const files = this.contextFiles();
    const used = this.usedSources();
    const notesById = new Map<string, string>();
    for (const u of used) {
      notesById.set(u.fileId, u.reasoningNote);
    }

    const result: EnrichedContextSource[] = files.map((f) => ({
      fileId: f.fileId,
      fileName: f.fileName,
      folderPath: f.folderPath,
      reason: f.reason,
      tokens: f.tokens,
      truncated: f.truncated,
      reasoningNote: notesById.get(f.fileId) ?? null,
    }));

    const seenIds = new Set(files.map((f) => f.fileId));
    for (const u of used) {
      if (!seenIds.has(u.fileId)) {
        result.push({
          fileId: u.fileId,
          fileName: u.fileName,
          folderPath: null,
          reason: 'COMPILED',
          tokens: null,
          truncated: false,
          reasoningNote: u.reasoningNote,
        });
      }
    }

    return result;
  });

  readonly totalTokens = computed(() =>
    this.contextFiles().reduce((acc, f) => acc + f.tokens, 0),
  );

  reasonLabel(reason: EnrichedContextSource['reason']): string {
    switch (reason) {
      case 'PINNED':
        return 'PINNED';
      case 'ALWAYS_INCLUDE':
        return 'ALWAYS';
      case 'SCOPE':
        return 'SCOPE';
      case 'COMPILED':
        return 'REFERENCED';
    }
  }
}
