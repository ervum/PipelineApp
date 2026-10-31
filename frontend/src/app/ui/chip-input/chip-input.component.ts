import { ChangeDetectionStrategy, Component, input, model, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';

@Component({
  selector: 'fs-chip-input',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './chip-input.component.html',
  styleUrl: './chip-input.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChipInputComponent {
  readonly values = model<string[]>([]);
  readonly suggestions = input<ReadonlyArray<string>>([]);
  readonly placeholder = input<string>('Add tag…');
  readonly max = input<number>(20);

  readonly draft = signal<string>('');

  addChip(raw: string): void {
    const clean = raw.trim();
    if (!clean) return;
    const current = this.values();
    if (current.length >= this.max() || current.includes(clean)) {
      this.draft.set('');
      return;
    }
    this.values.set([...current, clean]);
    this.draft.set('');
  }

  removeChip(tag: string): void {
    this.values.update((list) => list.filter((t) => t !== tag));
  }

  onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      this.addChip(this.draft());
    } else if (event.key === 'Backspace' && !this.draft() && this.values().length > 0) {
      const cur = this.values();
      this.values.set(cur.slice(0, -1));
    }
  }

  onInput(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }
}
