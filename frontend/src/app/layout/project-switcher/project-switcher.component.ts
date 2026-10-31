import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import { ProjectModel } from '@forge/shared';
import { StudioStateService } from '../../core/state/studio-state.service';
import { isModKey } from '../../core/utils/keyboard';
import { IconComponent } from '../../ui/icon/icon.component';

@Component({
  selector: 'fs-project-switcher',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './project-switcher.component.html',
  styleUrl: './project-switcher.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'onDocClick($event)',
    '(document:keydown)': 'onGlobalKey($event)',
  },
})
export class ProjectSwitcherComponent {
  private readonly hostEl = inject<ElementRef<HTMLElement>>(ElementRef);
  readonly studio = inject(StudioStateService);

  readonly collapsed = input<boolean>(false);
  readonly open = signal<boolean>(false);
  readonly search = signal<string>('');

  readonly filteredProjects = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.studio
      .visibleProjects()
      .filter(
        (p) =>
          !q ||
          p.name.toLowerCase().includes(q) ||
          p.genre.toLowerCase().includes(q) ||
          p.tagline.toLowerCase().includes(q),
      );
  });

  toggle(): void {
    const next = !this.open();
    this.open.set(next);
    if (next) {
      this.search.set('');
    }
  }

  select(project: ProjectModel): void {
    this.studio.selectProject(project.id);
    this.open.set(false);
  }

  openNewProject(): void {
    this.open.set(false);
    this.studio.openCreateProjectModal();
  }

  openSettings(): void {
    const active = this.studio.activeProject();
    if (!active) return;
    this.open.set(false);
    this.studio.openEditProjectModal(active);
  }

  onDocClick(event: MouseEvent): void {
    if (this.open() && !this.hostEl.nativeElement.contains(event.target as Node)) {
      this.open.set(false);
    }
  }

  onGlobalKey(event: KeyboardEvent): void {
    if (isModKey(event) && event.key.toLowerCase() === 'p') {
      event.preventDefault();
      this.toggle();
    } else if (event.key === 'Escape' && this.open()) {
      this.open.set(false);
    }
  }
}
