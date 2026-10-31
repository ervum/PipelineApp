import { DestroyRef, Directive, ElementRef, inject, input } from '@angular/core';

@Directive({
  selector: '[fsTooltip]',
  standalone: true,
  host: {
    '(mouseenter)': 'show()',
    '(mouseleave)': 'hide()',
    '(focus)': 'show()',
    '(blur)': 'hide()',
  },
})
export class TooltipDirective {
  readonly fsTooltip = input.required<string>();
  readonly placement = input<'top' | 'bottom' | 'right'>('top');

  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);
  private tooltipEl: HTMLDivElement | null = null;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.hide());
  }

  show(): void {
    const text = this.fsTooltip().trim();
    if (!text) return;
    this.hide();

    const el = document.createElement('div');
    el.className = 'fs-tooltip';
    el.setAttribute('role', 'tooltip');
    el.textContent = text;
    document.body.appendChild(el);
    this.tooltipEl = el;

    const hostRect = this.hostEl.nativeElement.getBoundingClientRect();
    const tipRect = el.getBoundingClientRect();
    const pos = this.placement();

    let top = hostRect.top - tipRect.height - 8;
    let left = hostRect.left + (hostRect.width - tipRect.width) / 2;

    if (pos === 'bottom' || top < 6) {
      top = hostRect.bottom + 8;
    } else if (pos === 'right') {
      top = hostRect.top + (hostRect.height - tipRect.height) / 2;
      left = hostRect.right + 8;
    }

    left = Math.max(8, Math.min(window.innerWidth - tipRect.width - 8, left));
    top = Math.max(8, Math.min(window.innerHeight - tipRect.height - 8, top));

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  hide(): void {
    if (this.tooltipEl) {
      this.tooltipEl.remove();
      this.tooltipEl = null;
    }
  }
}
