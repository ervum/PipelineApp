import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  ACTIVE_JOB_STATUSES,
  CompiledPrompt,
  CreateJobDto,
  JobModel,
  MiddlemanChunkEvent,
  Modality,
  RecompileDto,
  WorkerStatusEvent,
} from '@forge/shared';
import { JobsApi } from '../api/jobs.api';
import { SocketService } from '../realtime/socket.service';
import { AssetGalleryStore } from './asset-gallery.store';
import { StudioStateService } from './studio-state.service';
import { ToastService } from './toast.service';

export interface MiddlemanStream {
  jobId: string;
  text: string;
  seq: number;
  startedAt: number;
  done: boolean;
}

export interface WorkerState {
  phase: WorkerStatusEvent['phase'];
  coldStart: boolean;
  workers: WorkerStatusEvent['workers'];
  queueDelayMs: number | null;
  externalStatus: string;
}

@Injectable({ providedIn: 'root' })
export class GeneratorJobStore {
  private readonly api = inject(JobsApi);
  private readonly studio = inject(StudioStateService);
  private readonly socket = inject(SocketService);
  private readonly gallery = inject(AssetGalleryStore);
  private readonly toast = inject(ToastService);

  readonly jobs = signal<Record<string, JobModel>>({});
  readonly streams = signal<Record<string, MiddlemanStream>>({});
  readonly workerStates = signal<Record<string, WorkerState>>({});
  readonly focusedJobId = signal<Record<Modality, string | null>>({
    ICONS_2D: null,
    ASSETS_3D: null,
    IMAGES: null,
    VIDEO: null,
    LORE: null,
    MUSIC: null,
    VOICES: null,
    SFX: null,
    OTHER: null,
  });

  readonly jobList = computed(() =>
    Object.values(this.jobs()).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
  );

  readonly activeJobs = computed(() =>
    this.jobList().filter(
      (j) =>
        (ACTIVE_JOB_STATUSES as readonly string[]).includes(j.status) ||
        j.status === 'AWAITING_REVIEW',
    ),
  );

  readonly queueSummary = computed(() => ({
    running: this.activeJobs().filter((j) =>
      ['RUNNING', 'INGESTING', 'DISPATCHING'].includes(j.status),
    ).length,
    coldStarts: this.activeJobs().filter((j) => j.status === 'COLD_START').length,
    compiling: this.activeJobs().filter((j) => j.status === 'COMPILING').length,
    awaitingReview: this.activeJobs().filter((j) => j.status === 'AWAITING_REVIEW').length,
    queued: this.activeJobs().filter((j) => ['QUEUED', 'READY'].includes(j.status)).length,
  }));

  readonly focusedJob = (m: Modality) =>
    computed(() => {
      const id = this.focusedJobId()[m];
      return id ? (this.jobs()[id] ?? null) : null;
    });

  readonly streamFor = (jobId: string) => computed(() => this.streams()[jobId] ?? null);

  constructor() {
    effect(() => {
      const pid = this.studio.activeProjectId();
      untracked(() => {
        void this.reset(pid);
      });
    });

    this.socket.on('job:created', ({ job }) => this.upsert(job));
    this.socket.on('job:status', (e) => this.patch(e.jobId, { status: e.to }));
    this.socket.on('job:middleman-chunk', (e) => this.applyChunk(e));
    this.socket.on('job:middleman-complete', (e) => {
      this.patch(e.jobId, {
        compiled: e.compiled,
        contextFiles: e.contextFiles,
        status: e.nextStatus,
      });
      this.streams.update((s) =>
        s[e.jobId] ? { ...s, [e.jobId]: { ...s[e.jobId]!, done: true } } : s,
      );
    });
    this.socket.on('job:middleman-error', (e) =>
      this.toast.error(`Middleman failed: ${e.message}`),
    );
    this.socket.on('job:worker-status', (e) =>
      this.workerStates.update((w) => ({
        ...w,
        [e.jobId]: {
          phase: e.phase,
          coldStart: e.coldStart,
          workers: e.workers,
          queueDelayMs: e.queueDelayMs,
          externalStatus: e.externalStatus,
        },
      })),
    );
    this.socket.on('job:progress', (e) =>
      this.patch(e.jobId, { progressPercent: e.percent, progressStage: e.stage }),
    );
    this.socket.on('job:completed', (e) => {
      this.patch(e.jobId, {
        status: 'COMPLETED',
        progressPercent: 100,
        assetIds: e.assets.map((a) => a.id),
        costUsd: e.costUsd,
        executionMs: e.executionMs,
      });
      this.gallery.prepend(e.assets);
    });
    this.socket.on('job:failed', (e) => {
      this.patch(e.jobId, {
        status: 'FAILED',
        errorCode: e.code,
        errorMessage: e.message,
      });
      this.toast.error(e.message);
    });
    this.socket.onReconnect(() => {
      void this.resync();
    });
  }

  applyChunk(e: MiddlemanChunkEvent): void {
    this.streams.update((s) => {
      const cur = s[e.jobId] ?? {
        jobId: e.jobId,
        text: '',
        seq: -1,
        startedAt: Date.now(),
        done: false,
      };
      if (e.seq <= cur.seq) return s;
      return {
        ...s,
        [e.jobId]: { ...cur, text: cur.text + e.delta, seq: e.seq },
      };
    });
  }

  upsert(job: JobModel): void {
    this.jobs.update((map) => ({ ...map, [job.id]: job }));
  }

  patch(jobId: string, partial: Partial<JobModel>): void {
    this.jobs.update((map) => {
      const cur = map[jobId];
      if (!cur) return map;
      return { ...map, [jobId]: { ...cur, ...partial } };
    });
  }

  focus(modality: Modality, jobId: string | null): void {
    this.focusedJobId.update((cur) => ({ ...cur, [modality]: jobId }));
  }

  async reset(projectId: string | null): Promise<void> {
    this.jobs.set({});
    this.streams.set({});
    this.workerStates.set({});
    if (!projectId) return;
    try {
      const [activePage, recentPage] = await Promise.all([
        this.api.list({ projectId, active: true, limit: 50 }),
        this.api.list({ projectId, limit: 30 }),
      ]);
      const nextMap: Record<string, JobModel> = {};
      for (const j of [...recentPage.items, ...activePage.items]) {
        nextMap[j.id] = j;
      }
      this.jobs.set(nextMap);
    } catch {
      // handled by error interceptor
    }
  }

  async resync(): Promise<void> {
    const pid = this.studio.activeProjectId();
    if (!pid) return;
    await this.reset(pid);
  }

  async submit(dto: CreateJobDto): Promise<JobModel> {
    const job = await this.api.create(dto);
    this.upsert(job);
    this.focus(job.modality, job.id);
    this.socket.subscribeJob(job.id, (replay) =>
      replay.forEach((chunk) => this.applyChunk(chunk)),
    );
    return job;
  }

  async saveEdits(jobId: string, compiled: CompiledPrompt): Promise<JobModel> {
    const updated = await this.api.updateCompiled(jobId, compiled);
    this.upsert(updated);
    return updated;
  }

  async recompile(jobId: string, dto?: RecompileDto): Promise<JobModel> {
    this.streams.update((s) =>
      Object.fromEntries(Object.entries(s).filter(([k]) => k !== jobId)),
    );
    const updated = await this.api.recompile(jobId, dto);
    this.upsert(updated);
    this.socket.subscribeJob(jobId, (replay) =>
      replay.forEach((chunk) => this.applyChunk(chunk)),
    );
    return updated;
  }

  async dispatch(jobId: string): Promise<JobModel> {
    const updated = await this.api.dispatch(jobId);
    this.upsert(updated);
    return updated;
  }

  async cancel(jobId: string): Promise<JobModel> {
    const updated = await this.api.cancel(jobId);
    this.upsert(updated);
    return updated;
  }

  async retry(jobId: string): Promise<JobModel> {
    const updated = await this.api.retry(jobId);
    this.upsert(updated);
    this.focus(updated.modality, updated.id);
    return updated;
  }

  async duplicate(jobId: string): Promise<JobModel> {
    const created = await this.api.duplicate(jobId);
    this.upsert(created);
    this.focus(created.modality, created.id);
    return created;
  }
}
