import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  viewChild,
} from '@angular/core';
import {
  CONTEXT_SCOPE_LABEL,
  Modality,
  VaultFileModel,
  toMentionAlias,
} from '@forge/shared';
import { VaultStateService } from '../../../../core/state/vault-state.service';
import { iconForKind } from '../../../../core/utils/file-kind';
import { isEditableTarget } from '../../../../core/utils/keyboard';
import { IconComponent } from '../../../../ui/icon/icon.component';

const MODALITY_PLACEHOLDERS: Record<Modality, string> = {
  ICONS_2D:
    'A legendary fire katana icon with molten gold filigree… (Type @ to reference vault files)',
  ASSETS_3D:
    'A low-poly sci-fi supply crate with glowing cyan latches… (Type @ to reference vault files)',
  IMAGES:
    'Wide cinematic concept art of a floating crystal citadel at dusk… (Type @ to reference vault files)',
  VIDEO:
    'Cinematic slow-motion orbit around a storm-lit astral monolith with swirling runes… (Type @ to reference vault files)',
  LORE:
    'Complete multi-era backstory for Arch-Chronomancer Vaelen or a short relic tooltip… (Type @ to reference vault files)',
  MUSIC:
    'High-energy synthwave boss combat loop with driving bassline… (Type @ to reference vault files)',
  VOICES:
    'Battle-hardened commander delivering an urgent tactical warning… (Type @ to reference vault files)',
  SFX: 'Heavy plasma rifle charge and metallic recoil… (Type @ to reference vault files)',
  OTHER:
    '16-frame arcane explosion flipbook or stylized water shader… (Type @ to reference vault files)',
};

@Component({
  selector: 'fs-prompt-input',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './prompt-input.component.html',
  styleUrl: './prompt-input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptInputComponent {
  private readonly vault = inject(VaultStateService);
  private readonly destroyRef = inject(DestroyRef);

  readonly value = model<string>('');
  readonly modality = input.required<Modality>();

  readonly pinFile = output<string>();
  readonly generate = output<void>();
  readonly compileFirst = output<void>();

  readonly textareaRef = viewChild<ElementRef<HTMLTextAreaElement>>('textareaEl');

  readonly mentionOpen = signal(false);
  readonly mentionQuery = signal('');
  readonly mentionStartIdx = signal<number>(-1);
  readonly mentionResults = signal<VaultFileModel[]>([]);
  readonly activeIndex = signal(0);

  readonly scopeLabels = CONTEXT_SCOPE_LABEL;
  readonly iconForKind = iconForKind;

  readonly placeholder = computed(
    () => MODALITY_PLACEHOLDERS[this.modality()] ?? MODALITY_PLACEHOLDERS.ICONS_2D,
  );

  readonly charCount = computed(() => this.value().length);

  constructor() {
    // Global '/' shortcut to focus prompt input when not inside an editable element
    const onGlobalKeydown = (e: KeyboardEvent): void => {
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !isEditableTarget(e.target)) {
        e.preventDefault();
        this.focusTextarea();
      }
    };
    window.addEventListener('keydown', onGlobalKeydown);
    this.destroyRef.onDestroy(() => window.removeEventListener('keydown', onGlobalKeydown));

    // Debounced @mention search (150ms)
    effect((onCleanup) => {
      const open = this.mentionOpen();
      const q = this.mentionQuery();
      if (!open) {
        this.mentionResults.set([]);
        return;
      }

      const timer = setTimeout(() => {
        if (!q.trim()) {
          this.mentionResults.set(this.vault.files().slice(0, 8));
          this.activeIndex.set(0);
          return;
        }
        void this.vault.search(q).then((res) => {
          this.mentionResults.set(res.slice(0, 8));
          this.activeIndex.set(0);
        });
      }, 150);

      onCleanup(() => clearTimeout(timer));
    });
  }

  focusTextarea(): void {
    this.textareaRef()?.nativeElement.focus();
  }

  onInput(event: Event): void {
    const el = event.target as HTMLTextAreaElement;
    const text = el.value;
    this.value.set(text);
    this.autoResize(el);
    this.detectMention(text, el.selectionStart ?? text.length);
  }

  onKeyDown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        this.compileFirst.emit();
      } else {
        this.generate.emit();
      }
      return;
    }

    if (this.mentionOpen() && this.mentionResults().length > 0) {
      const len = this.mentionResults().length;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        this.activeIndex.update((i) => (i + 1) % len);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        this.activeIndex.update((i) => (i - 1 + len) % len);
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        const chosen = this.mentionResults()[this.activeIndex()];
        if (chosen) {
          this.insertMention(chosen);
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.mentionOpen.set(false);
        return;
      }
    }
  }

  insertMention(file: VaultFileModel): void {
    const el = this.textareaRef()?.nativeElement;
    const current = this.value();
    const start = this.mentionStartIdx();
    const caret = el?.selectionStart ?? current.length;
    const alias = `@${toMentionAlias(file.name)}`;

    if (start >= 0 && start <= caret) {
      const before = current.slice(0, start);
      const after = current.slice(caret);
      const next = `${before}${alias} ${after}`;
      this.value.set(next);
      setTimeout(() => {
        if (el) {
          const pos = before.length + alias.length + 1;
          el.focus();
          el.setSelectionRange(pos, pos);
          this.autoResize(el);
        }
      });
    } else {
      const next = `${current}${current.endsWith(' ') || !current ? '' : ' '}${alias} `;
      this.value.set(next);
    }

    this.pinFile.emit(file.id);
    this.mentionOpen.set(false);
  }

  private detectMention(text: string, caret: number): void {
    const uptoCaret = text.slice(0, caret);
    const match = /(?:^|\s)@([^\s@]*)$/.exec(uptoCaret);
    if (!match) {
      this.mentionOpen.set(false);
      return;
    }
    const query = match[1] ?? '';
    const atIndex = uptoCaret.lastIndexOf('@');
    this.mentionStartIdx.set(atIndex);
    this.mentionQuery.set(query);
    this.mentionOpen.set(true);
  }

  private autoResize(el: HTMLTextAreaElement): void {
    el.style.height = 'auto';
    const nextHeight = Math.min(Math.max(el.scrollHeight, 84), 260);
    el.style.height = `${nextHeight}px`;
  }
}
