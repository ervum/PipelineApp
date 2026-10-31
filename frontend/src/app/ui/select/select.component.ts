import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  model,
  output,
  signal,
} from '@angular/core';
import { ExecutionTier, HealthState } from '@forge/shared';
import { IconComponent } from '../icon/icon.component';
import { TierBadgeComponent } from '../tier-badge/tier-badge.component';

export interface SelectOption<T = string> {
  value: T;
  label: string;
  badge?: string;
  tier?: ExecutionTier;
  health?: HealthState;
  description?: string;
  disabled?: boolean;
}

@Component({
  selector: 'fs-select',
  standalone: true,
  imports: [IconComponent, TierBadgeComponent],
  templateUrl: './select.component.html',
  styleUrl: './select.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocumentClick($event)',
  },
})
export class SelectComponent<T = string> {
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly options = input.required<ReadonlyArray<SelectOption<T>>>();
  readonly value = model<T | null>(null);
  readonly placeholder = input<string>('Select…');
  readonly searchable = input<boolean>(false);
  readonly disabled = input<boolean>(false);
  readonly opened = output<void>();

  readonly isOpen = signal<boolean>(false);
  readonly search = signal<string>('');
  readonly highlightedIndex = signal<number>(0);

  readonly selectedOption = computed(
    () => this.options().find((o) => o.value === this.value()) ?? null,
  );

  readonly filteredOptions = computed(() => {
    const q = this.search().trim().toLowerCase();
    if (!q) return this.options();
    return this.options().filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.description ?? '').toLowerCase().includes(q) ||
        (o.badge ?? '').toLowerCase().includes(q),
    );
  });

  toggleOpen(): void {
    if (this.disabled()) return;
    const next = !this.isOpen();
    this.isOpen.set(next);
    if (next) {
      this.search.set('');
      const idx = this.filteredOptions().findIndex((o) => o.value === this.value());
      this.highlightedIndex.set(Math.max(0, idx));
      this.opened.emit();
    }
  }

  selectOption(opt: SelectOption<T>): void {
    if (opt.disabled) return;
    this.value.set(opt.value);
    this.isOpen.set(false);
  }

  onKeyDown(event: KeyboardEvent): void {
    if (this.disabled()) return;
    const list = this.filteredOptions();
    if (!this.isOpen()) {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'ArrowDown') {
        event.preventDefault();
        this.toggleOpen();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      this.isOpen.set(false);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.highlightedIndex.update((i) => Math.min(list.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.highlightedIndex.update((i) => Math.max(0, i - 1));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const target = list[this.highlightedIndex()];
      if (target && !target.disabled) {
        this.selectOption(target);
      }
    } else if (!this.searchable() && event.key.length === 1 && !event.ctrlKey && !event.metaKey) {
      const ch = event.key.toLowerCase();
      const foundIdx = list.findIndex((o) => o.label.toLowerCase().startsWith(ch));
      if (foundIdx !== -1) {
        this.highlightedIndex.set(foundIdx);
      }
    }
  }

  onSearchInput(event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    this.search.set(val);
    this.highlightedIndex.set(0);
  }

  onDocumentClick(event: MouseEvent): void {
    if (!this.isOpen()) return;
    if (!this.hostEl.nativeElement.contains(event.target as Node)) {
      this.isOpen.set(false);
    }
  }
}
