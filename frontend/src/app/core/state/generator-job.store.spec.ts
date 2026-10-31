import { TestBed } from '@angular/core/testing';
import { provideZonelessChangeDetection, signal } from '@angular/core';
import {
  AssetModel,
  JobModel,
  ServerToClientEvents,
  defaultParamsFor,
} from '@forge/shared';
import { JobsApi } from '../api/jobs.api';
import { SocketService } from '../realtime/socket.service';
import { AssetGalleryStore } from './asset-gallery.store';
import { GeneratorJobStore } from './generator-job.store';
import { StudioStateService } from './studio-state.service';

const SAMPLE_JOB: JobModel = {
  id: 'job-1',
  projectId: 'proj-1',
  modality: 'ICONS_2D',
  subMode: 'STANDARD',
  executionMode: 'AUTO_FIRE',
  status: 'COMPILING',
  rawPrompt: 'fire katana icon',
  pinnedFileIds: [],
  params: defaultParamsFor('ICONS_2D'),
  compiled: null,
  edited: null,
  contextFiles: [],
  providerConfigId: 'prov-1',
  providerName: 'Demo Synth',
  providerKind: 'DEMO',
  providerModel: 'demo-v1',
  tier: 'LOCAL',
  middlemanProfileId: 'prof-1',
  middlemanProfileName: 'Demo Compiler',
  externalJobId: null,
  externalStatus: null,
  progressPercent: 0,
  progressStage: null,
  coldStartMs: null,
  queueDelayMs: null,
  executionMs: null,
  costUsd: null,
  errorCode: null,
  errorMessage: null,
  attempt: 1,
  assetIds: [],
  createdAt: '2026-01-01T00:00:00.000Z',
  dispatchedAt: null,
  startedAt: null,
  completedAt: null,
};

describe('GeneratorJobStore', () => {
  let handlers: Partial<{
    [K in keyof ServerToClientEvents]: ServerToClientEvents[K];
  }>;
  let prependedAssets: AssetModel[];

  beforeEach(() => {
    handlers = {};
    prependedAssets = [];

    const mockJobsApi: Partial<JobsApi> = {
      list: () =>
        Promise.resolve({ items: [], nextCursor: null, total: 0 }),
    };

    const mockStudio = {
      activeProjectId: signal<string | null>(null),
    };

    const mockGallery: Pick<AssetGalleryStore, 'prepend'> = {
      prepend: (assets: AssetModel[]) => {
        prependedAssets.push(...assets);
      },
    };

    const mockSocket: Partial<SocketService> = {
      on: <E extends keyof ServerToClientEvents>(
        event: E,
        handler: ServerToClientEvents[E],
      ) => {
        handlers[event] = handler;
        return () => undefined;
      },
      onReconnect: () => undefined,
      subscribeJob: () => undefined,
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        { provide: JobsApi, useValue: mockJobsApi },
        { provide: StudioStateService, useValue: mockStudio },
        { provide: AssetGalleryStore, useValue: mockGallery },
        { provide: SocketService, useValue: mockSocket },
      ],
    });
  });

  it('orders middleman chunks, drops duplicate seqs, patches status, and prepends completed assets', () => {
    const store = TestBed.inject(GeneratorJobStore);

    handlers['job:created']?.({ job: SAMPLE_JOB });
    expect(store.jobs()['job-1']?.status).toBe('COMPILING');

    // Emit chunks: seq 0, seq 1, duplicate seq 1, seq 2
    handlers['job:middleman-chunk']?.({
      jobId: 'job-1',
      projectId: 'proj-1',
      seq: 0,
      delta: '{"assetTitle":',
      accumulatedChars: 14,
    });
    handlers['job:middleman-chunk']?.({
      jobId: 'job-1',
      projectId: 'proj-1',
      seq: 1,
      delta: '"Flame Katana"',
      accumulatedChars: 28,
    });
    handlers['job:middleman-chunk']?.({
      jobId: 'job-1',
      projectId: 'proj-1',
      seq: 1,
      delta: '"DUPLICATE"',
      accumulatedChars: 28,
    });
    handlers['job:middleman-chunk']?.({
      jobId: 'job-1',
      projectId: 'proj-1',
      seq: 2,
      delta: '}',
      accumulatedChars: 29,
    });

    expect(store.streamFor('job-1')()?.text).toBe(
      '{"assetTitle":"Flame Katana"}',
    );
    expect(store.streamFor('job-1')()?.seq).toBe(2);

    // Status transition
    handlers['job:status']?.({
      jobId: 'job-1',
      projectId: 'proj-1',
      from: 'COMPILING',
      to: 'RUNNING',
      at: '2026-01-01T00:00:01.000Z',
      message: 'Running',
    });
    expect(store.jobs()['job-1']?.status).toBe('RUNNING');

    // Completed event
    const sampleAsset: AssetModel = {
      id: 'asset-1',
      projectId: 'proj-1',
      jobId: 'job-1',
      modality: 'ICONS_2D',
      subMode: 'STANDARD',
      title: 'Flame Katana',
      assetGroupId: 'grp-1',
      version: 1,
      batchIndex: 0,
      parentAssetId: null,
      rawPrompt: 'fire katana icon',
      enhancedPrompt: 'Ornate flame katana icon',
      negativePrompt: '',
      approval: 'DRAFT',
      isFavorite: false,
      tags: [],
      notes: '',
      metadata: {
        modality: 'ICONS_2D',
        width: 1024,
        height: 1024,
        hasAlpha: true,
        frameShape: 'NONE',
        iconCategory: 'ITEM',
      },
      providerKind: 'DEMO',
      providerName: 'Demo Synth',
      providerModel: 'demo-v1',
      tier: 'LOCAL',
      costUsd: 0,
      executionMs: 420,
      seed: 123,
      files: [],
      primaryUrl: '/api/v1/media/assets/file-1',
      thumbnailUrl: '/api/v1/media/assets/file-1',
      savedToVaultFileId: null,
      createdAt: '2026-01-01T00:00:02.000Z',
    };

    handlers['job:completed']?.({
      jobId: 'job-1',
      projectId: 'proj-1',
      assets: [sampleAsset],
      costUsd: 0,
      executionMs: 420,
    });

    expect(store.jobs()['job-1']?.status).toBe('COMPLETED');
    expect(store.jobs()['job-1']?.progressPercent).toBe(100);
    expect(prependedAssets.map((a) => a.id)).toEqual(['asset-1']);
  });
});
