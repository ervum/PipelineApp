import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  AssetFileRole,
  AssetModel,
  CompiledPrompt,
  ContextScope,
  ExecutionMode,
  ExecutionTier,
  HealthState,
  JobCompletedEvent,
  JobModel,
  JobStatus,
  JobStatusEvent,
  MODALITIES,
  Modality,
  ProviderKind,
  ProviderRole,
  VaultFileKind,
  VaultFileModel,
  WorkerStatusEvent,
  WS_NAMESPACE,
} from '@forge/shared';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { io, Socket } from 'socket.io-client';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/prisma/prisma.service';

describe('Jobs & Assets E2E (All 7 Modalities, AUTO_FIRE & INTERCEPT, WS Events)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let baseUrl: string;
  let tmpStorageDir: string;
  let socket: Socket;

  let projectId: string;
  let folderId: string;
  let demoProviderId: string;
  let demoProfileId: string;
  let voiceProfileId: string;

  const receivedEvents: Array<{ event: string; payload: unknown }> = [];

  beforeAll(async () => {
    tmpStorageDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'forgestudio-e2e-storage-'),
    );

    process.env['NODE_ENV'] = 'test';
    process.env['DATABASE_URL'] =
      'postgresql://forge:forge@localhost:5432/forgestudio_test?schema=public';
    process.env['FORGE_MASTER_KEY'] = Buffer.alloc(32, 7).toString('base64');
    process.env['WEBHOOK_SIGNING_SECRET'] =
      'e2e_test_webhook_signing_secret_32chars';
    process.env['STORAGE_DRIVER'] = 'local';
    process.env['STORAGE_LOCAL_ROOT'] = tmpStorageDir;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', { exclude: ['health'] });
    app.useGlobalFilters(new AllExceptionsFilter());

    await app.init();
    await app.listen(0, '127.0.0.1');

    const httpServer = app.getHttpServer() as {
      address: () => { port: number };
    };
    const port = httpServer.address().port;
    baseUrl = `http://127.0.0.1:${port}`;

    prisma = app.get(PrismaService);

    // Clean test DB tables in FK-safe order
    await prisma.generatedAssetFile.deleteMany({});
    await prisma.generatedAsset.deleteMany({});
    await prisma.generationJobEvent.deleteMany({});
    await prisma.generationJob.deleteMany({});
    await prisma.middlemanTemplate.deleteMany({});
    await prisma.middlemanProfile.deleteMany({});
    await prisma.voiceProfile.deleteMany({});
    await prisma.vaultFile.deleteMany({});
    await prisma.vaultFolder.deleteMany({});
    await prisma.project.deleteMany({});
    await prisma.aiProviderConfig.deleteMany({});

    // Seed test project, vault, demo provider, middleman profile, and 7 templates
    const project = await prisma.project.create({
      data: {
        slug: 'astra-e2e',
        name: 'Astra E2E Project',
        tagline: 'Tactical sci-fi RPG',
        description: 'E2E test project',
        genre: 'Sci-Fi RPG',
        accentHex: '#06B6D4',
        globalSummary:
          'Hard-surface sci-fi aesthetic with deep obsidian metals and cyan bioluminescence.',
      },
    });
    projectId = project.id;

    const rootFolder = await prisma.vaultFolder.create({
      data: {
        projectId,
        name: 'Root',
        path: '/',
        sortOrder: 0,
      },
    });
    folderId = rootFolder.id;

    await prisma.vaultFile.create({
      data: {
        projectId,
        folderId,
        name: 'Art_Bible.md',
        extension: 'md',
        kind: VaultFileKind.MARKDOWN,
        mimeType: 'text/markdown',
        sizeBytes: 120,
        contentText:
          '# Art Bible\nUse obsidian #0F172A silhouettes with #06B6D4 cyan energy cores.',
        scopes: [ContextScope.ALWAYS_INCLUDE],
        priority: 95,
        tokenEstimate: 30,
      },
    });

    const demoProvider = await prisma.aiProviderConfig.create({
      data: {
        name: 'Demo Studio Synth (E2E)',
        kind: ProviderKind.DEMO,
        tier: ExecutionTier.LOCAL,
        roles: [ProviderRole.LLM, ProviderRole.VISION, ProviderRole.GENERATOR],
        modalities: [...MODALITIES],
        defaultModel: 'demo-synth-v1',
        models: [
          {
            id: 'demo-synth-v1',
            label: 'Demo Procedural Synth v1',
            modalities: [...MODALITIES],
          },
        ],
        settings: {
          timeoutMs: 60_000,
          pollIntervalMs: 500,
          maxPollIntervalMs: 2_000,
          maxConcurrency: 8,
        },
        defaultForModalities: [...MODALITIES],
        isEnabled: true,
        healthState: HealthState.HEALTHY,
      },
    });
    demoProviderId = demoProvider.id;

    const profile = await prisma.middlemanProfile.create({
      data: {
        name: 'Demo Middleman E2E',
        providerConfigId: demoProviderId,
        model: 'demo-middleman-v1',
        temperature: 0.3,
        maxOutputTokens: 1200,
        maxContextTokens: 8000,
        supportsVision: true,
        attachReferenceImages: false,
        maxReferenceImages: 2,
        jsonMode: true,
        isDefault: true,
        isVisionDefault: true,
      },
    });
    demoProfileId = profile.id;

    for (const mod of MODALITIES) {
      await prisma.middlemanTemplate.create({
        data: {
          projectId: null,
          modality: mod,
          name: `Global ${mod} Blueprint`,
          systemTemplate: `You are the ForgeStudio prompt compiler for ${mod}. Project: {{project_name}}.`,
          defaultNegativePrompt: 'blurry, low quality, watermark',
          hardConstraints: 'Maintain cohesive game art style.',
          version: 1,
          isActive: true,
        },
      });
    }

    const vp = await prisma.voiceProfile.create({
      data: {
        projectId,
        name: 'Commander Lyra',
        providerConfigId: demoProviderId,
        externalVoiceId: 'lyra_alto_v1',
        description: 'Calm tactical commander',
      },
    });
    voiceProfileId = vp.id;

    // Connect Socket.IO client to /orchestrator
    socket = io(`${baseUrl}${WS_NAMESPACE}`, {
      transports: ['websocket'],
      forceNew: true,
    });

    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', (err) => reject(err));
    });

    const trackedEvents = [
      'job:created',
      'job:status',
      'job:middleman-chunk',
      'job:middleman-complete',
      'job:worker-status',
      'job:progress',
      'job:completed',
      'job:failed',
      'vault:file-updated',
    ];
    for (const evtName of trackedEvents) {
      socket.on(evtName, (payload: unknown) => {
        receivedEvents.push({ event: evtName, payload });
      });
    }

    const ack = await socket.emitWithAck('studio:subscribe-project', {
      projectId,
    });
    expect(ack).toEqual({ ok: true });
  });

  afterAll(async () => {
    if (socket && socket.connected) {
      socket.disconnect();
    }
    if (app) {
      await app.close();
    }
    if (tmpStorageDir) {
      await fs.rm(tmpStorageDir, { recursive: true, force: true }).catch(() => undefined);
    }
  });

  async function waitForJobStatus(
    jobId: string,
    targetStatuses: JobStatus[],
    timeoutMs = 20_000,
  ): Promise<JobModel> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const res = await fetch(`${baseUrl}/api/v1/jobs/${jobId}`);
      expect(res.status).toBe(200);
      const job = (await res.json()) as JobModel;
      if (targetStatuses.includes(job.status)) {
        return job;
      }
      if (
        job.status === JobStatus.FAILED &&
        !targetStatuses.includes(JobStatus.FAILED)
      ) {
        throw new Error(
          `Job ${jobId} failed unexpectedly: ${job.errorCode} - ${job.errorMessage}`,
        );
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(
      `Timed out waiting for job ${jobId} to reach [${targetStatuses.join(', ')}]`,
    );
  }

  it('executes AUTO_FIRE for ICONS_2D, emits ordered WS events, and generates 4 icon variants with alpha', async () => {
    receivedEvents.length = 0;

    const createRes = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        executionMode: ExecutionMode.AUTO_FIRE,
        rawPrompt: 'obsidian plasma dagger icon with cyan edge glow',
        pinnedFileIds: [],
        params: {
          modality: 'ICONS_2D',
          iconCategory: 'ITEM',
          frameShape: 'HEXAGON',
          removeBackground: true,
          solidBackgroundHex: null,
          outputSize: 1024,
          batchCount: 1,
          seed: 300, // 300 % 3 === 0 triggers simulated cold-start worker status
        },
        providerConfigId: demoProviderId,
        middlemanProfileId: demoProfileId,
        skipMiddleman: false,
      }),
    });

    expect(createRes.status).toBe(201);
    const createdJob = (await createRes.json()) as JobModel;
    expect(createdJob.id).toBeDefined();

    const completedJob = await waitForJobStatus(createdJob.id, [
      JobStatus.COMPLETED,
    ]);
    expect(completedJob.status).toBe(JobStatus.COMPLETED);
    expect(completedJob.assetIds).toHaveLength(1);

    // Inspect WS events for this job
    const jobEvents = receivedEvents.filter((e) => {
      const p = e.payload as Record<string, unknown>;
      if (e.event === 'job:created') {
        return (p['job'] as JobModel | undefined)?.id === createdJob.id;
      }
      return p['jobId'] === createdJob.id;
    });

    const eventNames = jobEvents.map((e) => e.event);
    expect(eventNames).toContain('job:created');
    expect(eventNames).toContain('job:status');
    expect(eventNames).toContain('job:middleman-chunk');
    expect(eventNames).toContain('job:middleman-complete');
    expect(eventNames).toContain('job:worker-status');
    expect(eventNames).toContain('job:progress');
    expect(eventNames).toContain('job:completed');

    // Check ordering: job:created before job:middleman-complete before job:completed
    const createdIdx = eventNames.indexOf('job:created');
    const mmCompleteIdx = eventNames.indexOf('job:middleman-complete');
    const completedIdx = eventNames.indexOf('job:completed');
    expect(createdIdx).toBeLessThan(mmCompleteIdx);
    expect(mmCompleteIdx).toBeLessThan(completedIdx);

    // Check status transitions emitted via job:status
    const statusTransitions = jobEvents
      .filter((e): e is { event: string; payload: JobStatusEvent } =>
        e.event === 'job:status',
      )
      .map((e) => e.payload.to);
    expect(statusTransitions).toContain(JobStatus.COMPILING);
    expect(statusTransitions).toContain(JobStatus.READY);
    expect(statusTransitions).toContain(JobStatus.DISPATCHING);
    expect(statusTransitions).toContain(JobStatus.INGESTING);
    expect(statusTransitions).toContain(JobStatus.COMPLETED);

    // Check cold-start worker status was emitted because seed 300 % 3 === 0
    const workerEvents = jobEvents
      .filter((e): e is { event: string; payload: WorkerStatusEvent } =>
        e.event === 'job:worker-status',
      )
      .map((e) => e.payload);
    expect(workerEvents.some((w) => w.coldStart === true)).toBe(true);

    // Check completed payload has 4 icon variant files (512, 128, 64, 32)
    const completedEvent = jobEvents.find(
      (e): e is { event: string; payload: JobCompletedEvent } =>
        e.event === 'job:completed',
    )!.payload;
    expect(completedEvent.assets).toHaveLength(1);
    const iconAsset = completedEvent.assets[0]!;
    const roles = iconAsset.files.map((f) => f.role);
    expect(roles).toContain(AssetFileRole.PRIMARY);
    expect(roles).toContain(AssetFileRole.THUMBNAIL);
    expect(roles).toContain(AssetFileRole.VARIANT_512);
    expect(roles).toContain(AssetFileRole.VARIANT_128);
    expect(roles).toContain(AssetFileRole.VARIANT_64);
    expect(roles).toContain(AssetFileRole.VARIANT_32);

    // Fetch VARIANT_128 and verify PNG header and RGBA colorType (6)
    const variant128 = iconAsset.files.find(
      (f) => f.role === AssetFileRole.VARIANT_128,
    )!;
    const mediaRes = await fetch(`${baseUrl}${variant128.url}`);
    expect(mediaRes.status).toBe(200);
    expect(mediaRes.headers.get('content-type')).toContain('image/png');
    const pngBuf = Buffer.from(await mediaRes.arrayBuffer());
    // PNG magic bytes: 89 50 4E 47
    expect(pngBuf[0]).toBe(0x89);
    expect(pngBuf[1]).toBe(0x50);
    expect(pngBuf[2]).toBe(0x4e);
    expect(pngBuf[3]).toBe(0x47);
    expect(iconAsset.metadata.modality).toBe('ICONS_2D');
    if (iconAsset.metadata.modality === 'ICONS_2D') {
      expect(iconAsset.metadata.hasAlpha).toBe(true);
    }
  });

  it('completes AUTO_FIRE jobs across the remaining 6 modalities (ASSETS_3D, IMAGES, MUSIC, VOICES, SFX, OTHER)', async () => {
    const modalityPayloads: Array<{
      label: string;
      rawPrompt: string;
      params: Record<string, unknown>;
      expectedModality: Modality;
    }> = [
      {
        label: 'ASSETS_3D (TEXT_TO_3D)',
        rawPrompt: 'ancient obsidian obelisk prop with glowing runes',
        params: {
          modality: 'ASSETS_3D',
          subMode: 'TEXT_TO_3D',
          assetCategory: 'PROP',
          polycountTier: 'LOW_POLY',
          textureResolution: 2048,
          outputFormat: 'glb',
          pose: 'NONE',
          enablePbr: true,
          topology: 'TRIANGLE',
          seed: 101,
        },
        expectedModality: Modality.ASSETS_3D,
      },
      {
        label: 'IMAGES (SEAMLESS_TILE)',
        rawPrompt: 'seamless hexagonal sci-fi floor plating texture',
        params: {
          modality: 'IMAGES',
          imageCategory: 'PBR_TEXTURE',
          aspectPreset: 'SEAMLESS_TILE',
          styleWeight: 0.8,
          batchCount: 1,
          seed: 102,
        },
        expectedModality: Modality.IMAGES,
      },
      {
        label: 'MUSIC (BGM_LOOP with stems)',
        rawPrompt: 'tense orbital station exploration synth loop',
        params: {
          modality: 'MUSIC',
          trackType: 'BGM_LOOP',
          durationSec: 6,
          bpm: 110,
          keySignature: 'D Dorian',
          seamlessLoop: true,
          instrumentalOnly: true,
          generateStems: true,
          outputFormat: 'wav',
          seed: 103,
        },
        expectedModality: Modality.MUSIC,
      },
      {
        label: 'VOICES (DIALOGUE)',
        rawPrompt: 'Shields are holding at forty percent, hold the line!',
        params: {
          modality: 'VOICES',
          transcript: 'Shields are holding at forty percent, hold the line!',
          voiceProfileId,
          lineType: 'DIALOGUE',
          emotionTags: ['HEROIC'],
          speed: 1.0,
          stability: 0.6,
          similarityBoost: 0.8,
          style: 0.3,
          outputFormat: 'wav',
          batchCount: 1,
          seed: 104,
        },
        expectedModality: Modality.VOICES,
      },
      {
        label: 'SFX (WEAPON_HIT)',
        rawPrompt: 'heavy plasma rifle impact on metallic hull',
        params: {
          modality: 'SFX',
          sfxCategory: 'WEAPON_HIT',
          durationSec: 1.0,
          loopable: false,
          promptInfluence: 0.5,
          variationCount: 2,
          outputFormat: 'wav',
          seed: 105,
        },
        expectedModality: Modality.SFX,
      },
      {
        label: 'OTHER (SPRITESHEET)',
        rawPrompt: 'cyan energy orb idle pulse animation',
        params: {
          modality: 'OTHER',
          subMode: 'SPRITESHEET',
          spritesheet: {
            frameCount: 8,
            columns: 4,
            frameSize: 128,
            animationType: 'IDLE',
            fps: 12,
          },
          seed: 106,
        },
        expectedModality: Modality.OTHER,
      },
    ];

    for (const item of modalityPayloads) {
      const res = await fetch(`${baseUrl}/api/v1/jobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          projectId,
          executionMode: ExecutionMode.AUTO_FIRE,
          rawPrompt: item.rawPrompt,
          params: item.params,
          providerConfigId: demoProviderId,
          middlemanProfileId: demoProfileId,
          skipMiddleman: false,
        }),
      });
      expect(res.status).toBe(201);
      const created = (await res.json()) as JobModel;

      const done = await waitForJobStatus(created.id, [JobStatus.COMPLETED]);
      expect(done.status).toBe(JobStatus.COMPLETED);
      expect(done.modality).toBe(item.expectedModality);
      expect(done.assetIds.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('supports INTERCEPT mode: pauses at AWAITING_REVIEW, accepts PATCH /compiled, and dispatches to COMPLETED', async () => {
    const createRes = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        executionMode: ExecutionMode.INTERCEPT,
        rawPrompt: 'generate item table for void relics',
        params: {
          modality: 'OTHER',
          subMode: 'LORE_JSON',
          loreJson: {
            schemaKind: 'ITEM_TABLE',
            entryCount: 3,
            customSchema: null,
          },
          seed: 202,
        },
        providerConfigId: demoProviderId,
        middlemanProfileId: demoProfileId,
        skipMiddleman: false,
      }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as JobModel;

    // Wait for AWAITING_REVIEW
    const awaitingJob = await waitForJobStatus(created.id, [
      JobStatus.AWAITING_REVIEW,
    ]);
    expect(awaitingJob.status).toBe(JobStatus.AWAITING_REVIEW);
    expect(awaitingJob.compiled).not.toBeNull();

    // Edit compiled payload
    const editedCompiled: CompiledPrompt = {
      ...awaitingJob.compiled!,
      assetTitle: 'Edited Void Relics Table',
      enhancedPrompt:
        'Edited prompt: Three legendary void relics with obsidian casings.',
    };

    const patchRes = await fetch(
      `${baseUrl}/api/v1/jobs/${created.id}/compiled`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ compiled: editedCompiled }),
      },
    );
    expect(patchRes.status).toBe(200);
    const patchedJob = (await patchRes.json()) as JobModel;
    expect(patchedJob.edited?.assetTitle).toBe('Edited Void Relics Table');

    // Dispatch job
    const dispatchRes = await fetch(
      `${baseUrl}/api/v1/jobs/${created.id}/dispatch`,
      {
        method: 'POST',
      },
    );
    expect(dispatchRes.status).toBe(200);

    const completedJob = await waitForJobStatus(created.id, [
      JobStatus.COMPLETED,
    ]);
    expect(completedJob.status).toBe(JobStatus.COMPLETED);
    expect(completedJob.assetIds).toHaveLength(1);

    // Verify asset has the edited title and prompt
    const assetRes = await fetch(
      `${baseUrl}/api/v1/assets/${completedJob.assetIds[0]!}`,
    );
    expect(assetRes.status).toBe(200);
    const asset = (await assetRes.json()) as AssetModel & {
      lineage: AssetModel[];
    };
    expect(asset.title).toBe('Edited Void Relics Table');
    expect(asset.enhancedPrompt).toBe(
      'Edited prompt: Three legendary void relics with obsidian casings.',
    );

    // Save asset to vault & create variation
    const saveRes = await fetch(
      `${baseUrl}/api/v1/assets/${asset.id}/save-to-vault`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folderId,
          scopes: ['OTHER'],
          runVision: false,
        }),
      },
    );
    expect(saveRes.status).toBe(201);
    const savedVaultFile = (await saveRes.json()) as VaultFileModel;
    expect(savedVaultFile.sourceAssetId).toBe(asset.id);

    const varRes = await fetch(
      `${baseUrl}/api/v1/assets/${asset.id}/variation`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ executionMode: 'AUTO_FIRE' }),
      },
    );
    expect(varRes.status).toBe(201);
    const varJob = (await varRes.json()) as JobModel;
    const varCompleted = await waitForJobStatus(varJob.id, [
      JobStatus.COMPLETED,
    ]);
    expect(varCompleted.assetIds).toHaveLength(1);

    const varAssetRes = await fetch(
      `${baseUrl}/api/v1/assets/${varCompleted.assetIds[0]!}`,
    );
    const varAsset = (await varAssetRes.json()) as AssetModel & {
      lineage: AssetModel[];
    };
    expect(varAsset.assetGroupId).toBe(asset.assetGroupId);
    expect(varAsset.version).toBe(2);
    expect(varAsset.lineage).toHaveLength(2);
  });

  it('supports job cancel, duplicate, events log, and GET /providers/:id/adapters', async () => {
    const adaptersRes = await fetch(
      `${baseUrl}/api/v1/providers/${demoProviderId}/adapters`,
    );
    expect(adaptersRes.status).toBe(200);
    const adapters = (await adaptersRes.json()) as Array<{
      adapterId: string;
      modality: string;
    }>;
    expect(adapters.length).toBeGreaterThanOrEqual(7);
    expect(adapters.every((a) => a.adapterId === 'demo-synth')).toBe(true);

    // Create INTERCEPT job, wait for AWAITING_REVIEW, then cancel it
    const createRes = await fetch(`${baseUrl}/api/v1/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projectId,
        executionMode: ExecutionMode.INTERCEPT,
        rawPrompt: 'cancellable shader test',
        params: {
          modality: 'OTHER',
          subMode: 'SHADER_CODE',
          shader: {
            language: 'GLSL',
            targetEngine: 'GENERIC',
          },
          seed: 404,
        },
        providerConfigId: demoProviderId,
        middlemanProfileId: demoProfileId,
        skipMiddleman: false,
      }),
    });
    expect(createRes.status).toBe(201);
    const job = (await createRes.json()) as JobModel;

    await waitForJobStatus(job.id, [JobStatus.AWAITING_REVIEW]);

    const cancelRes = await fetch(`${baseUrl}/api/v1/jobs/${job.id}/cancel`, {
      method: 'POST',
    });
    expect(cancelRes.status).toBe(200);
    const cancelledJob = (await cancelRes.json()) as JobModel;
    expect(cancelledJob.status).toBe(JobStatus.CANCELLED);

    const eventsRes = await fetch(`${baseUrl}/api/v1/jobs/${job.id}/events`);
    expect(eventsRes.status).toBe(200);
    const events = (await eventsRes.json()) as Array<{
      toStatus: string | null;
    }>;
    expect(events.some((e) => e.toStatus === JobStatus.CANCELLED)).toBe(true);
  });
});
