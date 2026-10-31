import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { CONTEXT_SCOPE_LABEL, VaultFileDetailModel, estimateTokens } from '@forge/shared';
import { VaultStateService } from '../../../core/state/vault-state.service';
import { isModKey } from '../../../core/utils/keyboard';
import { ButtonComponent } from '../../../ui/button/button.component';
import { IconComponent } from '../../../ui/icon/icon.component';
import { SplitPaneComponent } from '../../../ui/split-pane/split-pane.component';
import { JsonTreeViewComponent } from '../../generators/previews/json-tree-view/json-tree-view.component';
import { MarkdownPreviewComponent } from '../markdown-preview/markdown-preview.component';

@Component({
  selector: 'fs-file-editor',
  standalone: true,
  imports: [
    ButtonComponent,
    IconComponent,
    SplitPaneComponent,
    MarkdownPreviewComponent,
    JsonTreeViewComponent,
  ],
  templateUrl: './file-editor.component.html',
  styleUrl: './file-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileEditorComponent {
  readonly vault = inject(VaultStateService);
  readonly closeEditor = output<void>();

  readonly textareaRef = viewChild<ElementRef<HTMLTextAreaElement>>('editorArea');
  readonly editingName = signal<boolean>(false);
  readonly nameDraft = signal<string>('');

  readonly scopeLabels = CONTEXT_SCOPE_LABEL;

  readonly liveTokens = computed(() => estimateTokens(this.vault.draftContent()));

  startRename(file: VaultFileDetailModel): void {
    this.nameDraft.set(file.name);
    this.editingName.set(true);
  }

  async commitRename(file: VaultFileDetailModel): Promise<void> {
    this.editingName.set(false);
    const next = this.nameDraft().trim();
    if (next && next !== file.name) {
      await this.vault.renameFile(file.id, next);
    }
  }

  onKeyDown(event: KeyboardEvent): void {
    const el = this.textareaRef()?.nativeElement;
    if (!el) return;

    if (isModKey(event) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void this.vault.saveDraft();
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      this.insertAroundSelection(el, '  ', '');
      return;
    }

    if (isModKey(event) && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      this.insertAroundSelection(el, '**', '**');
      return;
    }

    if (isModKey(event) && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      this.insertAroundSelection(el, '*', '*');
      return;
    }

    if (event.key === 'Enter') {
      const start = el.selectionStart ?? 0;
      const before = this.vault.draftContent().slice(0, start);
      const lastLine = before.split('\n').pop() ?? '';
      const listMatch = /^(\s*(?:[-*]|\d+\.)\s+)/.exec(lastLine);
      if (listMatch?.[1] && lastLine.trim().length > listMatch[1].trim().length) {
        event.preventDefault();
        this.insertAroundSelection(el, `\n${listMatch[1]}`, '');
      }
    }
  }

  private insertAroundSelection(
    el: HTMLTextAreaElement,
    prefix: string,
    suffix: string,
  ): void {
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? 0;
    const cur = this.vault.draftContent();
    const selected = cur.slice(start, end);
    const next = cur.slice(0, start) + prefix + selected + suffix + cur.slice(end);
    this.vault.draftContent.set(next);
    queueMicrotask(() => {
      el.focus();
      el.setSelectionRange(start + prefix.length, end + prefix.length);
    });
  }
}
