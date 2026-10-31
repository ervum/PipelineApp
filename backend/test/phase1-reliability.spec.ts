import {
  AssetFileRole,
  ErrorCode,
  GenerationSubMode,
  JobStatus,
  Modality,
  ProviderKind,
  VisionStatus,
} from '@forge/shared';
import { JobStateService } from '../src/generators/job-state.service';
import { OutputIngestionService } from '../src/generators/output-ingestion.service';
import { McpToolsService } from '../src/mcp/mcp-tools.service';
import { JobEventsPublisherPort } from '../src/orchestrator/job-events.port';
import { PrismaService } from '../src/prisma/prisma.service';
import { VisionAnalysisService } from '../src/projects-vault/vision-analysis.service';
import { ImageProcessingService } from '../src/storage/image-processing.service';
import { createSeamedTilePng } from './fixtures/media-fixtures';

describe('Phase 1 — Reliability & Correctness', () => {
  describe('1.1 JobStateService automatic retry with backoff', () => {
    it('auto-retries retryable failures into READY (with notBefore backoff) when compiledPayload exists and attempt < maxAttempts', async () => {
      const updatedRows: Array<Record<string, unknown>> = [];
      const events: Array<Record<string, unknown>> = [];
      const publisher: jest.Mocked<JobEventsPublisherPort> = {
        jobCreated: jest.fn(),
        jobStatus: jest.fn(),
        middlemanChunk: jest.fn(),
        middlemanComplete: jest.fn(),
        middlemanError: jest.fn(),
        workerStatus: jest.fn(),
        progress: jest.fn(),
        completed: jest.fn(),
        failed: jest.fn(),
        vaultFileUpdated: jest.fn(),
        providerHealth: jest.fn(),
      };

      const txMock = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            id: 'job_retry_1',
            projectId: 'prj_1',
            status: JobStatus.RUNNING,
            startedAt: new Date(),
            errorCode: null,
            errorMessage: null,
            attempt: 1,
            maxAttempts: 3,
            compiledPayload: { enhancedPrompt: 'compiled' },
            skipMiddleman: false,
          },
        ]),
        generationJob: {
          update: jest.fn().mockImplementation(async ({ data }) => {
            updatedRows.push(data);
            return { id: 'job_retry_1', projectId: 'prj_1', ...data };
          }),
        },
        generationJobEvent: {
          create: jest.fn().mockImplementation(async ({ data }) => {
            events.push(data);
            return { id: 'evt_1', ...data };
          }),
        },
      };

      const prismaMock = {
        $transaction: jest.fn().mockImplementation(async (cb) => cb(txMock)),
      } as unknown as PrismaService;

      const service = new JobStateService(prismaMock, publisher);
      const res = await service.transition(
        'job_retry_1',
        JobStatus.FAILED,
        {
          errorCode: ErrorCode.PROVIDER_TIMEOUT,
          errorMessage: 'Provider timed out',
        },
        'Provider timed out',
        { retryable: true },
      );

      expect(res.status).toBe(JobStatus.READY);
      expect(updatedRows[0]?.['attempt']).toBe(2);
      expect(updatedRows[0]?.['notBefore']).toBeInstanceOf(Date);
      expect(events[0]?.['type']).toBe('retry');
      expect(publisher.jobStatus).toHaveBeenCalledWith(
        expect.objectContaining({
          from: JobStatus.RUNNING,
          to: JobStatus.READY,
        }),
      );
      expect(publisher.failed).not.toHaveBeenCalled();
    });

    it('transitions directly to FAILED without auto-retry on non-retryable error codes (e.g. UNAUTHORIZED)', async () => {
      const publisher: jest.Mocked<JobEventsPublisherPort> = {
        jobCreated: jest.fn(),
        jobStatus: jest.fn(),
        middlemanChunk: jest.fn(),
        middlemanComplete: jest.fn(),
        middlemanError: jest.fn(),
        workerStatus: jest.fn(),
        progress: jest.fn(),
        completed: jest.fn(),
        failed: jest.fn(),
        vaultFileUpdated: jest.fn(),
        providerHealth: jest.fn(),
      };

      const txMock = {
        $queryRaw: jest.fn().mockResolvedValue([
          {
            id: 'job_unauth_1',
            projectId: 'prj_1',
            status: JobStatus.DISPATCHING,
            startedAt: null,
            errorCode: null,
            errorMessage: null,
            attempt: 1,
            maxAttempts: 3,
            compiledPayload: { enhancedPrompt: 'compiled' },
            skipMiddleman: false,
          },
        ]),
        generationJob: {
          update: jest.fn().mockImplementation(async ({ data }) => ({
            id: 'job_unauth_1',
            projectId: 'prj_1',
            ...data,
          })),
        },
        generationJobEvent: {
          create: jest.fn().mockResolvedValue({ id: 'evt_1' }),
        },
      };

      const prismaMock = {
        $transaction: jest.fn().mockImplementation(async (cb) => cb(txMock)),
      } as unknown as PrismaService;

      const service = new JobStateService(prismaMock, publisher);
      const res = await service.transition(
        'job_unauth_1',
        JobStatus.FAILED,
        {
          errorCode: ErrorCode.PROVIDER_AUTH_FAILED,
          errorMessage: 'Invalid API key',
        },
        'Invalid API key',
        { retryable: true },
      );

      expect(res.status).toBe(JobStatus.FAILED);
      expect(publisher.failed).toHaveBeenCalled();
    });
  });

  describe('1.2 & 1.5 OutputIngestionService batch lineage and VFX_TEXTURE seam score', () => {
    it('keeps all batched variation outputs in parent assetGroupId with sequential versions and records VFX_TEXTURE tileSeamScore', async () => {
      const createdAssets: Array<Record<string, unknown>> = [];
      const imageProc = new ImageProcessingService();
      const tilePng = await createSeamedTilePng(64);

      const prismaMock = {
        generatedAsset: {
          findUnique: jest.fn().mockResolvedValue({ assetGroupId: 'grp_parent_1' }),
          aggregate: jest.fn().mockResolvedValue({ _max: { version: 2 } }),
          create: jest.fn().mockImplementation(async ({ data }) => {
            createdAssets.push(data);
            return {
              ...data,
              createdAt: new Date(),
              updatedAt: new Date(),
              files: (data.files?.create ?? []).map((f: Record<string, unknown>, i: number) => ({
                id: `file_${i}`,
                ...f,
                createdAt: new Date(),
              })),
              savedToVault: null,
            };
          }),
        },
        $transaction: jest.fn().mockImplementation(async (cb) => cb(prismaMock)),
      } as unknown as PrismaService;

      const storageMock = {
        putBuffer: jest.fn().mockResolvedValue(undefined),
      };
      const costEstimatorMock = {
        estimate: jest.fn().mockReturnValue(0.02),
      };
      const jobStateMock = {
        transition: jest.fn().mockResolvedValue({}),
      };
      const publisherMock = {
        completed: jest.fn(),
      };

      const ingestion = new OutputIngestionService(
        prismaMock,
        storageMock as never,
        imageProc,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        costEstimatorMock as never,
        jobStateMock as never,
        publisherMock as never,
      );

      const assets = await ingestion.ingest({
        job: {
          id: 'job_var_batch',
          projectId: 'prj_1',
          modality: Modality.OTHER,
          subMode: GenerationSubMode.VFX_TEXTURE,
          rawPrompt: 'nebula noise',
          userParams: { __parentAssetId: 'ast_parent_1' },
          providerModel: 'demo-v1',
          seed: 100,
        } as never,
        project: { id: 'prj_1', slug: 'starfall' } as never,
        provider: {
          id: 'prov_1',
          name: 'Demo Synth',
          kind: ProviderKind.DEMO,
          tier: 'LOCAL',
          defaultModel: 'demo-v1',
        } as never,
        params: {
          modality: 'OTHER',
          subMode: 'VFX_TEXTURE',
          spritesheet: {
            frameCount: 16,
            columns: 4,
            frameSize: 256,
            animationType: 'LOOP_FX',
            fps: 12,
          },
          vfx: {
            textureType: 'NOISE',
            grayscale: true,
            tileable: true,
            resolution: 512,
          },
          shader: { language: 'LUAU', targetEngine: 'ROBLOX' },
          loreJson: { schemaKind: 'ITEM_TABLE', entryCount: 8, customSchema: null },
          seed: 100,
        },
        compiled: {
          assetTitle: 'Nebula Noise',
          enhancedPrompt: 'Seamless nebula noise vfx texture',
          negativePrompt: '',
          recommendedParams: {},
          compilerNotes: '',
          contextSourcesUsed: [],
        },
        outputs: [
          {
            batchIndex: 0,
            role: AssetFileRole.PRIMARY,
            fileName: 'vfx_0.png',
            mimeType: 'image/png',
            kind: 'buffer',
            data: tilePng,
          },
          {
            batchIndex: 1,
            role: AssetFileRole.PRIMARY,
            fileName: 'vfx_1.png',
            mimeType: 'image/png',
            kind: 'buffer',
            data: tilePng,
          },
          {
            batchIndex: 2,
            role: AssetFileRole.PRIMARY,
            fileName: 'vfx_2.png',
            mimeType: 'image/png',
            kind: 'buffer',
            data: tilePng,
          },
        ],
        supportsNativeTransparency: true,
      });

      expect(assets).toHaveLength(3);
      expect(createdAssets.map((a) => a['assetGroupId'])).toEqual([
        'grp_parent_1',
        'grp_parent_1',
        'grp_parent_1',
      ]);
      expect(createdAssets.map((a) => a['version'])).toEqual([3, 4, 5]);
      const meta0 = createdAssets[0]?.['metadata'] as Record<string, unknown>;
      expect(typeof meta0['tileSeamScore']).toBe('number');
      expect(meta0['tileSeamScore']).toBeGreaterThan(0);
    });
  });

  describe('1.3 VisionAnalysisService persistent recovery & retry', () => {
    it('recovers interrupted RUNNING rows back to PENDING when visionAttempts < 3 and marks FAILED when >= 3', async () => {
      const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
      const prismaMock = {
        vaultFile: {
          findMany: jest.fn().mockResolvedValue([
            {
              id: 'vf_retry',
              projectId: 'prj_1',
              name: 'ref1.png',
              extension: 'png',
              kind: 'IMAGE',
              mimeType: 'image/png',
              sizeBytes: 100,
              scopes: [],
              priority: 50,
              description: '',
              tokenEstimate: 0,
              visionStatus: VisionStatus.RUNNING,
              visionAttempts: 1,
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
              folder: { path: '/' },
            },
            {
              id: 'vf_exhausted',
              projectId: 'prj_1',
              name: 'ref2.png',
              extension: 'png',
              kind: 'IMAGE',
              mimeType: 'image/png',
              sizeBytes: 100,
              scopes: [],
              priority: 50,
              description: '',
              tokenEstimate: 0,
              visionStatus: VisionStatus.RUNNING,
              visionAttempts: 3,
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
              folder: { path: '/' },
            },
          ]),
          update: jest.fn().mockImplementation(async ({ where, data }) => {
            updates.push({ id: where.id, data });
            return {
              id: where.id,
              projectId: 'prj_1',
              name: 'ref.png',
              extension: 'png',
              kind: 'IMAGE',
              mimeType: 'image/png',
              sizeBytes: 100,
              scopes: [],
              priority: 50,
              description: '',
              tokenEstimate: 0,
              visionStatus: data.visionStatus ?? VisionStatus.FAILED,
              visionAttempts: 3,
              metadata: {},
              createdAt: new Date(),
              updatedAt: new Date(),
              folder: { path: '/' },
            };
          }),
          findUnique: jest.fn().mockResolvedValue(null),
        },
      } as unknown as PrismaService;

      const eventsMock = {
        vaultFileUpdated: jest.fn(),
      };

      const service = new VisionAnalysisService(
        prismaMock,
        {} as never,
        {} as never,
        {} as never,
        eventsMock as never,
      );

      await service.recover();

      expect(updates).toEqual(
        expect.arrayContaining([
          {
            id: 'vf_retry',
            data: { visionStatus: VisionStatus.PENDING },
          },
          expect.objectContaining({
            id: 'vf_exhausted',
            data: expect.objectContaining({
              visionStatus: VisionStatus.FAILED,
            }),
          }),
        ]),
      );
    });
  });

  describe('1.4 McpToolsService persistent DB logs & Socket.IO broadcast', () => {
    it('persists tool invocations to prisma.mcpInvocationLog and emits mcp:invocation event', async () => {
      const dbLogs: Array<Record<string, unknown>> = [];
      const prismaMock = {
        mcpInvocationLog: {
          create: jest.fn().mockImplementation(async ({ data }) => {
            dbLogs.push(data);
            return data;
          }),
          findMany: jest.fn().mockImplementation(async () => dbLogs),
          count: jest.fn().mockImplementation(async () => dbLogs.length),
          deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        },
      } as unknown as PrismaService;

      const eventsMock = {
        mcpInvocation: jest.fn(),
      };

      const service = new McpToolsService(
        prismaMock,
        {} as never,
        {} as never,
        { list: async () => [] } as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        eventsMock as never,
      );

      await service.callTool(
        'forge_list_projects',
        { note: 'x'.repeat(500) },
        'STDIO',
      );

      expect(dbLogs).toHaveLength(1);
      expect(dbLogs[0]?.['toolName']).toBe('forge_list_projects');
      expect(dbLogs[0]?.['transport']).toBe('STDIO');
      expect(String(dbLogs[0]?.['argsSummary']).length).toBeLessThanOrEqual(180);
      expect(eventsMock.mcpInvocation).toHaveBeenCalledWith(
        expect.objectContaining({
          totalInvocations: 1,
          entry: expect.objectContaining({
            toolName: 'forge_list_projects',
            transport: 'STDIO',
          }),
        }),
      );
    });
  });
});
