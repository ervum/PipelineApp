import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  model,
  output,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';

export interface MenuItem {
  id: string;
  label: string;
  icon?: string;
  danger?: boolean;
  disabled?: boolean;
  dividerBefore?: boolean;
}

@Component({
  selector: 'fs-context-menu',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './context-menu.component.html',
  styleUrl: './context-menu.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'close()',
    '(document:keydown.escape)': 'close()',
  },
})
export class ContextMenuComponent {
  readonly items = input.required<ReadonlyArray<MenuItem>>();
  readonly open = model<boolean>(false);
  readonly anchor = input<{ x: number; y: number }>({ x: 0, y: 0 });
  readonly select = output<string>();

  readonly clampedX = computed(() => Math.min(window.innerWidth - 200, Math.max(8, this.anchor().x)));
  readonly clampedY = computed(() => Math.min(window.innerHeight - 220, Math.max(8, this.anchor().y)));

  choose(item: MenuItem, event: MouseEvent): void {
    event.stopPropagation();
    if (item.disabled) return;
    this.open.set(false);
    this.select.emit(item.id);
  }

  close(): void {
    if (this.open()) {
      this.open.set(false);
    }
  }
}
