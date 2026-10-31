import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  model,
  signal,
} from '@angular/core';
import { CreateProjectSchema, ProjectModel, estimateTokens } from '@forge/shared';
import { StudioStateService } from '../../../core/state/studio-state.service';
import { ToastService } from '../../../core/state/toast.service';
import { ButtonComponent } from '../../../ui/button/button.component';
import { ModalComponent } from '../../../ui/modal/modal.component';

@Component({
  selector: 'fs-project-form-modal',
  standalone: true,
  imports: [ModalComponent, ButtonComponent],
  templateUrl: './project-form-modal.component.html',
  styleUrl: './project-form-modal.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectFormModalComponent {
  private readonly studio = inject(StudioStateService);
  private readonly toast = inject(ToastService);

  readonly open = model<boolean>(false);
  readonly project = input<ProjectModel | null>(null);

  readonly name = signal<string>('');
  readonly tagline = signal<string>('');
  readonly genre = signal<string>('');
  readonly accentHex = signal<string>('#7C3AED');
  readonly description = signal<string>('');
  readonly globalSummary = signal<string>('');
  readonly saving = signal<boolean>(false);
  readonly fieldError = signal<string | null>(null);

  readonly isEdit = computed(() => this.project() !== null);

  readonly slugPreview = computed(() => {
    const raw = this.name()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
    return raw || 'project-slug';
  });

  readonly summaryTokens = computed(() => estimateTokens(this.globalSummary()));

  constructor() {
    effect(() => {
      const p = this.project();
      if (this.open()) {
        this.fieldError.set(null);
        if (p) {
          this.name.set(p.name);
          this.tagline.set(p.tagline);
          this.genre.set(p.genre);
          this.accentHex.set(p.accentHex);
          this.description.set(p.description);
          this.globalSummary.set(p.globalSummary);
        } else {
          this.name.set('');
          this.tagline.set('');
          this.genre.set('');
          this.accentHex.set('#7C3AED');
          this.description.set('');
          this.globalSummary.set('');
        }
      }
    });
  }

  async save(): Promise<void> {
    this.fieldError.set(null);
    const payload = {
      name: this.name().trim(),
      tagline: this.tagline().trim(),
      genre: this.genre().trim(),
      accentHex: this.accentHex().trim(),
      description: this.description().trim(),
      globalSummary: this.globalSummary().trim(),
    };

    const parsed = CreateProjectSchema.safeParse(payload);
    if (!parsed.success) {
      this.fieldError.set(parsed.error.issues[0]?.message ?? 'Invalid project fields');
      return;
    }

    this.saving.set(true);
    try {
      const existing = this.project();
      if (existing) {
        await this.studio.updateProject(existing.id, parsed.data);
        this.toast.success(`Updated project "${parsed.data.name}"`);
      } else {
        await this.studio.createProject(parsed.data);
        this.toast.success(`Created project "${parsed.data.name}"`);
      }
      this.open.set(false);
    } catch (err: unknown) {
      this.fieldError.set(err instanceof Error ? err.message : 'Failed to save project');
    } finally {
      this.saving.set(false);
    }
  }
}
