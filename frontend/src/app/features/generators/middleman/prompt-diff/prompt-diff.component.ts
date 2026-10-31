import { ChangeDetectionStrategy, Component, computed, input, model } from '@angular/core';
import { DiffSegment, wordDiff } from '@forge/shared';
import {
  SegmentedControlComponent,
  SegmentedOption,
} from '../../../../ui/segmented-control/segmented-control.component';

@Component({
  selector: 'fs-prompt-diff',
  standalone: true,
  imports: [SegmentedControlComponent],
  templateUrl: './prompt-diff.component.html',
  styleUrl: './prompt-diff.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PromptDiffComponent {
  readonly before = input.required<string>();
  readonly after = input.required<string>();
  readonly mode = model<'inline' | 'split'>('inline');

  readonly modeOptions: ReadonlyArray<SegmentedOption<'inline' | 'split'>> = [
    { value: 'inline', label: 'Inline' },
    { value: 'split', label: 'Split' },
  ];

  readonly segments = computed<DiffSegment[]>(() => wordDiff(this.before(), this.after()));

  readonly stats = computed(() => {
    let added = 0;
    let removed = 0;
    for (const seg of this.segments()) {
      const words = seg.text.trim() ? seg.text.trim().split(/\s+/).length : 0;
      if (seg.op === 'insert') added += words;
      if (seg.op === 'delete') removed += words;
    }
    return { added, removed };
  });
}
