import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  input,
  linkedSignal,
  output,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AdapterDescriptor, CompiledPrompt, JobModel, ParamSpec } from '@forge/shared';
import { GeneratorJobStore, MiddlemanStream } from '../../../../core/state/generator-job.store';
import { ButtonComponent } from '../../../../ui/button/button.component';
import { CodeViewComponent } from '../../../../ui/code-view/code-view.component';
import { IconComponent } from '../../../../ui/icon/icon.component';
import { SelectComponent, SelectOption } from '../../../../ui/select/select.component';
import { ToggleComponent } from '../../../../ui/toggle/toggle.component';
import { ContextSourcesListComponent } from '../context-sources-list/context-sources-list.component';
import { PromptDiffComponent } from '../prompt-diff/prompt-diff.component';

type ReviewTab = 'DIFF' | 'ENHANCED' | 'NEGATIVE' | 'PARAMS' | 'SOURCES' | 'RAW';

interface RecommendedParamEntry {
  key: string;
  value: string | number | boolean | null | string[];
  spec: ParamSpec | null;
}

@Component({
  selector: 'fs-compile-review-drawer',
  standalone: true,
  imports: [
    FormsModule,
    ButtonComponent,
    IconComponent,
    SelectComponent,
    ToggleComponent,
    PromptDiffComponent,
    ContextSourcesListComponent,
    CodeViewComponent,
  ],
  templateUrl: './compile-review-drawer.component.html',
  styleUrl: './compile-review-drawer.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompileReviewDrawerComponent {
  private readonly jobStore = inject(GeneratorJobStore);

  readonly job = input.required<JobModel>();
  readonly descriptor = input<AdapterDescriptor | null>(null);
  readonly stream = input<MiddlemanStream | null>(null);

  readonly closed = output<void>();

  readonly activeTab = signal<ReviewTab>('DIFF');
  readonly busy = signal(false);
  readonly recompileOpen = signal(false);

  readonly recompilePrompt = linkedSignal<JobModel, string>({
    source: this.job,
    computation: (j) => j.rawPrompt,
  });

  readonly draft = linkedSignal<JobModel, CompiledPrompt>({
    source: this.job,
    computation: (j) => {
      const src = j.edited ?? j.compiled;
      if (src) {
        return {
          assetTitle: src.assetTitle,
          enhancedPrompt: src.enhancedPrompt,
          negativePrompt: src.negativePrompt,
          recommendedParams: { ...src.recommendedParams },
          contextSourcesUsed: src.contextSourcesUsed.map((c) => ({ ...c })),
          warnings: [...src.warnings],
        };
      }
      return {
        assetTitle: j.rawPrompt.slice(0, 60) || 'Untitled Asset',
        enhancedPrompt: j.rawPrompt,
        negativePrompt: '',
        recommendedParams: {},
        contextSourcesUsed: [],
        warnings: [],
      };
    },
  });

  readonly maxPromptChars = computed(() => this.descriptor()?.maxPromptChars ?? 4000);

  readonly paramEntries = computed<RecommendedParamEntry[]>(() => {
    const rec = this.draft().recommendedParams;
    const specsByKey = new Map<string, ParamSpec>();
    for (const s of this.descriptor()?.paramSpecs ?? []) {
      specsByKey.set(s.key, s);
    }
    return Object.entries(rec).map(([key, value]) => ({
      key,
      value,
      spec: specsByKey.get(key) ?? null,
    }));
  });

  readonly rawStreamText = computed(() => {
    const s = this.stream()?.text;
    if (s && s.trim().length > 0) return s;
    const src = this.job().edited ?? this.job().compiled;
    return src ? JSON.stringify(src, null, 2) : '{}';
  });

  readonly isDirty = computed(() => {
    const baseline = this.job().edited ?? this.job().compiled;
    if (!baseline) return true;
    const d = this.draft();
    return (
      d.assetTitle !== baseline.assetTitle ||
      d.enhancedPrompt !== baseline.enhancedPrompt ||
      d.negativePrompt !== baseline.negativePrompt ||
      JSON.stringify(d.recommendedParams) !== JSON.stringify(baseline.recommendedParams)
    );
  });

  @HostListener('document:keydown', ['$event'])
  onKeyDown(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void this.dispatchJob();
    }
  }

  setTab(tab: ReviewTab): void {
    this.activeTab.set(tab);
  }

  patchDraft(partial: Partial<CompiledPrompt>): void {
    this.draft.set({ ...this.draft(), ...partial });
  }

  patchRecommendedParam(key: string, value: string | number | boolean): void {
    const cur = this.draft();
    this.draft.set({
      ...cur,
      recommendedParams: {
        ...cur.recommendedParams,
        [key]: value,
      },
    });
  }

  enumOptions(spec: ParamSpec): SelectOption<string>[] {
    return (spec.options ?? []).map((opt) => ({ value: opt.value, label: opt.label }));
  }

  asNumber(val: unknown, fallback = 0): number {
    return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
  }

  asString(val: unknown): string {
    if (val === null || val === undefined) return '';
    if (Array.isArray(val)) return val.join(', ');
    return String(val);
  }

  asBool(val: unknown): boolean {
    return Boolean(val);
  }

  async runRecompile(): Promise<void> {
    if (this.busy()) return;
    const prompt = this.recompilePrompt().trim();
    if (!prompt) return;
    this.busy.set(true);
    try {
      this.recompileOpen.set(false);
      await this.jobStore.recompile(this.job().id, { rawPrompt: prompt });
    } finally {
      this.busy.set(false);
    }
  }

  async discardJob(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.jobStore.cancel(this.job().id);
      this.closed.emit();
    } finally {
      this.busy.set(false);
    }
  }

  async dispatchJob(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const jobId = this.job().id;
      if (this.isDirty()) {
        await this.jobStore.saveEdits(jobId, this.draft());
      }
      await this.jobStore.dispatch(jobId);
      this.closed.emit();
    } finally {
      this.busy.set(false);
    }
  }
}
