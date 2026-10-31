import {
  ErrorCode,
  ExecutionTier,
  JobStatus,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { JobStateService } from '../src/generators/job-state.service';
import { JobsService } from '../src/generators/jobs.service';

describe('Phase 5 — Provider Orchestration, Failover & Cost Analytics', () => {
  describe('5.1 Automatic Provider Failover Chains', () => {
    it('fails over to the next enabled fallbackProviderId when primary provider exhausts maxAttempts', async () => {
      const updatedPayloads: Array<Record<string, unknown>> = [];
      const createdEvents: Array<Record<string, unknown>> = [];

      const txMock = {
        $queryRaw: jest.fn(async () => [
          {
            id: 'job_failover_1',
            projectId: 'proj_1',
            status: JobStatus.RUNNING,
            startedAt: new Date(),
            errorCode: null,
            errorMessage: null,
            attempt: 3,
            maxAttempts: 3,
            compiledPayload: { enhancedPrompt: 'Crystal shield' },
            skipMiddleman: false,
            providerConfigId: 'prov_primary',
            modality: 'ICONS_2D',
            userParams: { modality: 'ICONS_2D' },
          },
        ]),
        aiProviderConfig: {
          findUnique: jest.fn(async () => ({
            id: 'prov_primary',
            name: 'Primary Cloud',
            settings: {
              fallbackProviderIds: ['prov_disabled', 'prov_backup'],
            },
          })),
          findMany: jest.fn(async () => [
            {
              id: 'prov_backup',
              name: 'Backup RunPod',
              defaultModel: 'flux-backup-v1',
              tier: ExecutionTier.RUNPOD,
              isEnabled: true,
              modalities: ['ICONS_2D', 'IMAGES'],
              settings: { maxAttempts: 2 },
            },
          ]),
        },
        generationJob: {
          update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
            updatedPayloads.push(data);
            return {
              id: 'job_failover_1',
              projectId: 'proj_1',
              status: data['status'],
              attempt: data['attempt'],
              maxAttempts: data['maxAttempts'],
              errorCode: data['errorCode'] ?? null,
              errorMessage: data['errorMessage'] ?? null,
            };
          }),
        },
        generationJobEvent: {
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
            createdEvents.push(data);
            return data;
          }),
        },
      };

      const prismaMock = {
        $transaction: jest.fn(async (cb: (tx: typeof txMock) => Promise<unknown>) =>
          cb(txMock),
        ),
      };
      const publisherMock = {
        jobStatus: jest.fn(),
        failed: jest.fn(),
      };

      const service = new JobStateService(
        prismaMock as never,
        publisherMock as never,
      );

      const res = await service.transition(
        'job_failover_1',
        JobStatus.FAILED,
        {
          errorCode: ErrorCode.PROVIDER_TIMEOUT,
          errorMessage: 'Primary provider timed out after 3 attempts',
        },
        'Primary provider timed out',
        { retryable: true },
      );

      expect(res.status).toBe(JobStatus.READY);
      expect(res.attempt).toBe(1);
      expect(updatedPayloads[0]?.['providerConfig']).toEqual({
        connect: { id: 'prov_backup' },
      });
      expect(updatedPayloads[0]?.['providerModel']).toBe('flux-backup-v1');
      expect(createdEvents[0]?.['type']).toBe('provider-failover');
      expect(String(createdEvents[0]?.['message'])).toContain('Backup RunPod');
      expect(publisherMock.failed).not.toHaveBeenCalled();
    });
  });

  describe('5.2 & 5.3 Multi-Provider Arena & Cost/Budget Analytics', () => {
    it('dispatches parallel Arena jobs with shared seed and enforces monthlyBudgetUsd caps', async () => {
      const createdJobs: Array<Record<string, unknown>> = [];
      let currentMonthSpent = 4.5;

      const prismaMock = {
        project: {
          findUnique: jest.fn(async () => ({ id: 'proj_1', slug: 'astra' })),
        },
        generationJob: {
          aggregate: jest.fn(async () => ({
            _sum: { costUsd: currentMonthSpent },
          })),
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
            const row = {
              id: `job_${createdJobs.length + 1}`,
              ...data,
              attempt: 1,
              progressPercent: 0,
              progressStage: null,
              workerId: null,
              remoteJobId: null,
              errorCode: null,
              errorMessage: null,
              costUsd: null,
              executionMs: null,
              queueDelayMs: null,
              coldStartMs: null,
              createdAt: new Date('2026-10-31T02:00:00.000Z'),
              startedAt: null,
              completedAt: null,
              notBefore: null,
              compiledPayload: null,
              editedPayload: null,
              contextFileIds: [],
              middlemanUsage: null,
              providerConfig: {
                id: data['providerConfigId'],
                name: `Provider ${String(data['providerConfigId'])}`,
                kind: ProviderKind.DEMO,
              },
              middlemanProfile: null,
              assets: [],
            };
            createdJobs.push(row);
            return row;
          }),
          findMany: jest.fn(async () => [
            {
              id: 'j1',
              modality: Modality.ICONS_2D,
              status: JobStatus.COMPLETED,
              providerConfigId: 'prov_a',
              costUsd: 0.04,
              executionMs: 1200,
              queueDelayMs: 80,
              coldStartMs: 0,
              createdAt: new Date('2026-10-30T10:00:00.000Z'),
            },
            {
              id: 'j2',
              modality: Modality.ASSETS_3D,
              status: JobStatus.COMPLETED,
              providerConfigId: 'prov_b',
              costUsd: 0.25,
              executionMs: 8400,
              queueDelayMs: 150,
              coldStartMs: 2100,
              createdAt: new Date('2026-10-31T10:00:00.000Z'),
            },
          ]),
        },
        generationJobEvent: {
          create: jest.fn(async () => ({})),
        },
        aiProviderConfig: {
          findMany: jest.fn(async () => [
            {
              id: 'prov_a',
              name: 'Cloud Alpha',
              settings: { monthlyBudgetUsd: 10 },
            },
            {
              id: 'prov_b',
              name: 'RunPod Beta',
              settings: { monthlyBudgetUsd: 25 },
            },
          ]),
        },
        $transaction: jest.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
          cb(prismaMock),
        ),
      };

      const providersServiceMock = {
        getRuntimeConfig: jest.fn(async (id: string) => ({
          id,
          name: `Provider ${id}`,
          kind: ProviderKind.DEMO,
          tier: ExecutionTier.FREE,
          isEnabled: true,
          modalities: [Modality.ICONS_2D, Modality.IMAGES],
          defaultModel: `model-${id}`,
          settings: {
            autoRetry: true,
            maxAttempts: 3,
            monthlyBudgetUsd: 10,
          },
        })),
      };

      const adapterRegistryMock = {
        resolve: jest.fn(() => ({})),
      };
      const processorMock = {
        tick: jest.fn(async () => undefined),
      };
      const publisherMock = {
        jobCreated: jest.fn(),
      };

      const service = new JobsService(
        prismaMock as never,
        providersServiceMock as never,
        adapterRegistryMock as never,
        {} as never,
        processorMock as never,
        {} as never,
        publisherMock as never,
      );

      const arenaRes = await service.createArena({
        projectId: 'proj_1',
        executionMode: 'AUTO_FIRE',
        rawPrompt: 'Arcane mana potion icon',
        pinnedFileIds: [],
        params: {
          modality: 'ICONS_2D',
          iconCategory: 'ITEM',
          frameShape: 'HEXAGON',
          frameStrokeHex: null,
          removeBackground: true,
          bgRemovalTolerance: 38,
          solidBackgroundHex: null,
          outputSize: 512,
          batchCount: 1,
          seed: null,
        },
        providerTargets: [
          { providerConfigId: 'prov_a', providerModel: 'flux-schnell' },
          { providerConfigId: 'prov_b', providerModel: 'sdxl-lightning' },
        ],
        middlemanProfileId: null,
        skipMiddleman: false,
      });

      expect(arenaRes.arenaGroupId).toMatch(/^arn_/);
      expect(arenaRes.jobs).toHaveLength(2);
      expect(arenaRes.jobs[0]?.seed).toBe(arenaRes.jobs[1]?.seed);

      // Exceeding monthlyBudgetUsd ($10.00) must reject with 402
      currentMonthSpent = 10.5;
      await expect(
        service.create({
          projectId: 'proj_1',
          executionMode: 'AUTO_FIRE',
          rawPrompt: 'Over budget icon',
          pinnedFileIds: [],
          params: {
            modality: 'ICONS_2D',
            iconCategory: 'ITEM',
            frameShape: 'NONE',
            frameStrokeHex: null,
            removeBackground: true,
            bgRemovalTolerance: 38,
            solidBackgroundHex: null,
            outputSize: 512,
            batchCount: 1,
            seed: 42,
          },
          advanced: {},
          providerConfigId: 'prov_a',
          providerModel: null,
          middlemanProfileId: null,
          skipMiddleman: false,
          parentAssetId: null,
        }),
      ).rejects.toThrow(/monthly budget cap/);

      const summary = await service.getAnalyticsSummary('proj_1', 30);
      expect(summary.totalJobs).toBe(2);
      expect(summary.completedJobs).toBe(2);
      expect(summary.totalCostUsd).toBeCloseTo(0.29, 4);
      expect(summary.byModality).toHaveLength(2);
      expect(summary.byProvider).toHaveLength(2);
      expect(summary.dailySeries).toHaveLength(2);
    });
  });
});
