import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import {
  CONTEXT_SCOPES,
  CONTEXT_SCOPE_LABEL,
  ContextScope,
  VaultFileModel,
} from '@forge/shared';
import { VaultStateService } from '../../../core/state/vault-state.service';
import { accentForScope } from '../../../core/utils/file-kind';
import { SliderComponent } from '../../../ui/slider/slider.component';

@Component({
  selector: 'fs-scope-tag-editor',
  standalone: true,
  imports: [SliderComponent],
  templateUrl: './scope-tag-editor.component.html',
  styleUrl: './scope-tag-editor.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScopeTagEditorComponent {
  private readonly vault = inject(VaultStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly file = input.required<VaultFileModel>();

  readonly allScopes = CONTEXT_SCOPES;
  readonly scopeLabels = CONTEXT_SCOPE_LABEL;
  readonly accentForScope = accentForScope;

  readonly scopes = signal<ContextScope[]>([]);
  readonly priority = signal<number>(50);
  readonly description = signal<string>('');

  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private loadedFileId: string | null = null;

  constructor() {
    effect(() => {
      const f = this.file();
      untracked(() => {
        if (this.loadedFileId !== f.id) {
          this.loadedFileId = f.id;
          this.scopes.set([...f.scopes]);
          this.priority.set(f.priority);
          this.description.set(f.description);
        } else {
          this.scopes.set([...f.scopes]);
        }
      });
    });

    this.destroyRef.onDestroy(() => {
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
    });
  }

  hasScope(scope: ContextScope): boolean {
    return this.scopes().includes(scope);
  }

  toggleScope(scope: ContextScope): void {
    const cur = this.scopes();
    const next = cur.includes(scope) ? cur.filter((s) => s !== scope) : [...cur, scope];
    this.scopes.set(next);
    this.scheduleSave();
  }

  onPriorityChange(val: number): void {
    this.priority.set(val);
    this.scheduleSave();
  }

  onDescriptionInput(event: Event): void {
    this.description.set((event.target as HTMLTextAreaElement).value);
    this.scheduleSave();
  }

  private scheduleSave(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const targetId = this.file().id;
    const scopes = this.scopes();
    const priority = this.priority();
    const description = this.description();
    this.debounceTimer = setTimeout(() => {
      void this.vault.updateFileMetadata(targetId, { scopes, priority, description });
    }, 400);
  }
}
