import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';

@Component({
  selector: 'fs-split-pane',
  standalone: true,
  templateUrl: './split-pane.component.html',
  styleUrl: './split-pane.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.--split]': '(ratio() * 100) + "%"',
  },
})
export class SplitPaneComponent {
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly ratio = model<number>(0.5);
  readonly persistKey = input<string | null>(null);
  readonly isDragging = signal<boolean>(false);

  constructor() {
    effect(() => {
      const key = this.persistKey();
      if (!key) return;
      const saved = localStorage.getItem(`forge.split.${key}`);
      if (saved) {
        const parsed = Number(saved);
        if (Number.isFinite(parsed) && parsed >= 0.2 && parsed <= 0.8) {
          this.ratio.set(parsed);
        }
      }
    });

    effect(() => {
      const key = this.persistKey();
      const r = this.ratio();
      if (key) {
        localStorage.setItem(`forge.split.${key}`, r.toFixed(3));
      }
    });
  }

  onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    this.isDragging.set(true);
  }

  onPointerMove(event: PointerEvent): void {
    if (!this.isDragging()) return;
    const rect = this.hostEl.nativeElement.getBoundingClientRect();
    if (rect.width <= 0) return;
    const next = (event.clientX - rect.left) / rect.width;
    const clamped = Math.max(0.2, Math.min(0.8, next));
    this.ratio.set(clamped);
  }

  onPointerUp(event: PointerEvent): void {
    if (!this.isDragging()) return;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) {
      target.releasePointerCapture(event.pointerId);
    }
    this.isDragging.set(false);
  }
}
