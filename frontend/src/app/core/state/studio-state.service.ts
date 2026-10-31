import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router } from '@angular/router';
import { CreateProjectDto, Modality, ProjectModel, UpdateProjectDto } from '@forge/shared';
import { filter, map, startWith } from 'rxjs';
import { ProjectsApi } from '../api/projects.api';
import { SocketService } from '../realtime/socket.service';
import { modalityFromUrl } from '../utils/format';

@Injectable({ providedIn: 'root' })
export class StudioStateService {
  private readonly api = inject(ProjectsApi);
  private readonly socket = inject(SocketService);
  private readonly router = inject(Router);
  private readonly storageKey = 'forge.activeProjectId';

  readonly projects = signal<ProjectModel[]>([]);
  readonly activeProjectId = signal<string | null>(localStorage.getItem(this.storageKey));
  readonly sidebarCollapsed = signal<boolean>(
    localStorage.getItem('forge.sidebarCollapsed') === '1',
  );
  readonly historyCollapsed = signal<boolean>(false);
  readonly loading = signal<boolean>(true);
  readonly loadSucceeded = signal<boolean>(false);
  readonly projectFormModalOpen = signal<boolean>(false);
  readonly editingProject = signal<ProjectModel | null>(null);

  private readonly readyPromise: Promise<void>;

  readonly activeProject = computed(
    () => this.projects().find((p) => p.id === this.activeProjectId()) ?? null,
  );
  readonly activeProjectSignal = this.activeProject;
  readonly visibleProjects = computed(() => this.projects().filter((p) => !p.archived));

  readonly activeModality = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => modalityFromUrl(this.router.url)),
      startWith(modalityFromUrl(this.router.url)),
    ),
    { initialValue: null as Modality | null },
  );

  constructor() {
    this.readyPromise = this.load();

    this.socket.onReconnect(() => {
      if (!this.loadSucceeded() || this.projects().length === 0) {
        void this.load();
      }
    });

    effect(() => {
      const id = this.activeProjectId();
      if (id) {
        localStorage.setItem(this.storageKey, id);
      } else {
        localStorage.removeItem(this.storageKey);
      }
    });

    effect((onCleanup) => {
      const id = this.activeProjectId();
      if (!id) return;
      this.socket.subscribeProject(id);
      onCleanup(() => this.socket.unsubscribeProject(id));
    });

    effect(() => {
      document.documentElement.style.setProperty(
        '--fs-project-accent',
        this.activeProject()?.accentHex ?? '#7C3AED',
      );
    });

    effect(() => {
      localStorage.setItem('forge.sidebarCollapsed', this.sidebarCollapsed() ? '1' : '0');
    });
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  private async load(): Promise<void> {
    try {
      const list = await this.api.list();
      this.projects.set(list);
      this.loadSucceeded.set(true);
      if (!list.some((p) => p.id === this.activeProjectId())) {
        this.activeProjectId.set(list.find((p) => !p.archived)?.id ?? null);
      }
    } catch {
      // Backend may still be booting during concurrent dev startup; onReconnect will retry.
    } finally {
      this.loading.set(false);
    }
  }

  selectProject(id: string): void {
    this.activeProjectId.set(id);
  }

  openCreateProjectModal(): void {
    this.editingProject.set(null);
    this.projectFormModalOpen.set(true);
  }

  openEditProjectModal(project: ProjectModel): void {
    this.editingProject.set(project);
    this.projectFormModalOpen.set(true);
  }

  async createProject(dto: CreateProjectDto): Promise<ProjectModel> {
    const p = await this.api.create(dto);
    this.projects.update((l) => [...l, p]);
    this.selectProject(p.id);
    return p;
  }

  async updateProject(id: string, dto: UpdateProjectDto): Promise<void> {
    const p = await this.api.update(id, dto);
    this.projects.update((l) => l.map((x) => (x.id === id ? p : x)));
  }

  async refreshStats(): Promise<void> {
    const list = await this.api.list();
    this.projects.set(list);
  }
}
