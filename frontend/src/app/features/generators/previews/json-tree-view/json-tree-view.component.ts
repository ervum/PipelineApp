import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { ToastService } from '../../../../core/state/toast.service';
import { CodeViewComponent } from '../../../../ui/code-view/code-view.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';

export interface JsonNodeView {
  key: string;
  path: string;
  kind: 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';
  value: unknown;
  children?: JsonNodeView[];
}

function buildJsonTree(val: unknown, key = 'root', path = '$'): JsonNodeView {
  if (val === null || val === undefined) {
    return { key, path, kind: 'null', value: null };
  }
  if (Array.isArray(val)) {
    return {
      key,
      path,
      kind: 'array',
      value: val,
      children: val.map((item, idx) => buildJsonTree(item, `[${idx}]`, `${path}[${idx}]`)),
    };
  }
  if (typeof val === 'object') {
    const entries = Object.entries(val as Record<string, unknown>);
    return {
      key,
      path,
      kind: 'object',
      value: val,
      children: entries.map(([k, v]) => buildJsonTree(v, k, `${path}.${k}`)),
    };
  }
  if (typeof val === 'number') {
    return { key, path, kind: 'number', value: val };
  }
  if (typeof val === 'boolean') {
    return { key, path, kind: 'boolean', value: val };
  }
  return { key, path, kind: 'string', value: String(val) };
}

@Component({
  selector: 'fs-json-tree-view',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    IconComponent,
    SegmentedControlComponent,
    CodeViewComponent,
  ],
  templateUrl: './json-tree-view.component.html',
  styleUrl: './json-tree-view.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class JsonTreeViewComponent {
  private readonly toast = inject(ToastService);

  readonly content = input<string>('');
  readonly src = input<string | null>(null);
  readonly fetchedContent = signal<string | null>(null);
  readonly mode = signal<'tree' | 'raw'>('tree');
  readonly collapsedPaths = signal<Set<string>>(new Set());

  readonly modeOptions: ReadonlyArray<SegmentedOption<'tree' | 'raw'>> = [
    { value: 'tree', label: 'Tree' },
    { value: 'raw', label: 'Raw' },
  ];

  readonly resolvedText = computed(() => this.fetchedContent() ?? this.content());

  readonly parsed = computed(() => {
    try {
      const value: unknown = JSON.parse(this.resolvedText() || 'null');
      return { valid: true as const, tree: buildJsonTree(value), error: null };
    } catch (err: unknown) {
      return {
        valid: false as const,
        tree: null,
        error: err instanceof Error ? err.message : 'Invalid JSON',
      };
    }
  });

  constructor() {
    effect(() => {
      const url = this.src();
      untracked(() => {
        if (!url) {
          this.fetchedContent.set(null);
          return;
        }
        void fetch(url)
          .then((r) => (r.ok ? r.text() : '{}'))
          .then((txt) => this.fetchedContent.set(txt))
          .catch(() => this.fetchedContent.set('{}'));
      });
    });
  }

  isCollapsed(path: string): boolean {
    return this.collapsedPaths().has(path);
  }

  togglePath(path: string): void {
    this.collapsedPaths.update((set) => {
      const next = new Set(set);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  copyPath(path: string): void {
    if (navigator.clipboard) {
      void navigator.clipboard.writeText(path);
      this.toast.info(`Copied path ${path}`);
    }
  }
}
