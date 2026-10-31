import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  viewChild,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

export interface JsonValidity {
  valid: boolean;
  error: string | null;
  line: number | null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

@Component({
  selector: 'fs-json-editor',
  standalone: true,
  templateUrl: './json-editor.component.html',
  styleUrl: './json-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JsonEditorComponent {
  private readonly sanitizer = inject(DomSanitizer);

  readonly value = model<string>('{\n}');
  readonly variables = input<ReadonlyArray<string>>([]);
  readonly validity = output<JsonValidity>();

  readonly textareaRef = viewChild.required<ElementRef<HTMLTextAreaElement>>('editorTextarea');
  readonly preRef = viewChild.required<ElementRef<HTMLPreElement>>('overlayPre');

  readonly lines = computed(() => {
    const count = Math.max(1, this.value().split('\n').length);
    return Array.from({ length: count }, (_, i) => i + 1);
  });

  readonly validationState = computed<JsonValidity>(() => {
    const raw = this.value().trim();
    if (!raw) {
      return { valid: false, error: 'JSON cannot be empty', line: 1 };
    }
    try {
      JSON.parse(raw);
      return { valid: true, error: null, line: null };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Invalid JSON';
      const posMatch = /position\s+(\d+)/i.exec(msg);
      let line: number | null = null;
      if (posMatch?.[1]) {
        const pos = Number(posMatch[1]);
        line = raw.slice(0, pos).split('\n').length;
      }
      return { valid: false, error: msg, line };
    }
  });

  readonly highlightedHtml = computed<SafeHtml>(() => {
    const escaped = escapeHtml(this.value());
    const withVars = escaped.replace(
      /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g,
      '<span class="json-var">{{$1}}</span>',
    );
    return this.sanitizer.bypassSecurityTrustHtml(withVars + '\n');
  });

  constructor() {
    effect(() => {
      this.validity.emit(this.validationState());
    });
  }

  onInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    this.value.set(el.value);
  }

  onScroll(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    const pre = this.preRef().nativeElement;
    pre.scrollTop = el.scrollTop;
    pre.scrollLeft = el.scrollLeft;
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Tab') {
      event.preventDefault();
      this.insertAtCaret('  ');
    }
  }

  insertAtCaret(text: string): void {
    const el = this.textareaRef().nativeElement;
    const start = el.selectionStart ?? this.value().length;
    const end = el.selectionEnd ?? this.value().length;
    const cur = this.value();
    const next = cur.slice(0, start) + text + cur.slice(end);
    this.value.set(next);
    queueMicrotask(() => {
      el.focus();
      const nextCaret = start + text.length;
      el.setSelectionRange(nextCaret, nextCaret);
    });
  }
}
