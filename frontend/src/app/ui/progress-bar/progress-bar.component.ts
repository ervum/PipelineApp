import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type ProgressAccent = 'violet' | 'cyan' | 'emerald' | 'amber' | 'coral';

@Component({
  selector: 'fs-progress',
  standalone: true,
  templateUrl: './progress-bar.component.html',
  styleUrl: './progress-bar.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgressBarComponent {
  readonly value = input<number | null>(null);
  readonly accent = input<ProgressAccent>('violet');

  readonly clampedValue = computed(() => {
    const v = this.value();
    if (v === null || !Number.isFinite(v)) return 0;
    return Math.max(0, Math.min(100, v));
  });

  readonly classes = computed(() => {
    const list = ['fs-progress'];
    if (this.value() === null) {
      list.push('fs-progress--indeterminate');
    }
    const acc = this.accent();
    if (acc !== 'violet') {
      list.push(`fs-progress--${acc}`);
    }
    return list.join(' ');
  });
}
