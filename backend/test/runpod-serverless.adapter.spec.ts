import {
  AssetFileRole,
  ErrorCode,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ProviderKind,
  ProviderRole,
} from '@forge/shared';
import { GenerationJob, Project } from '@prisma/client';
import { DomainError } from '../src/common/errors/domain.error';
import { HttpClientService } from '../src/common/http/http-client.service';
import { RunPodClient } from '../src/generators/adapters/runpod/runpod-client';
import {
  extractMappedOutputs,
  RunPodServerlessAdapter,
} from '../src/generators/adapters/runpod/runpod-serverless.adapter';
import { GeneratorDispatchContext } from '../src/generators/generator-adapter.interface';
import { ProviderRuntimeConfig } from '../src/providers/providers.service';

function makeMockDispatchContext(
  overrides?: Partial<GeneratorDispatchContext>,
): GeneratorDispatchContext {
  const provider: ProviderRuntimeConfig = {
    id: 'prv_runpod_1',
    name: 'RunPod Flux Serverless',
    kind: ProviderKind.RUNPOD_SERVERLESS,
    tier: ExecutionTier.RUNPOD,
    roles: [ProviderRole.GENERATOR],
    modalities: [Modality.ICONS_2D, Modality.IMAGES],
    baseUrl: 'https://api.runpod.ai/v2',
    secret: 'rpa_test_secret_1234',
    runpodEndpointId: 'ep_flux_test',
    defaultModel: 'flux-1-dev',
    models: [],
    payloadTemplate: {
      prompt: '{{enhanced_prompt}}',
      negative_prompt: '{{negative_prompt}}',
      seed: '{{seed}}',
      width: '{{width}}',
      height: '{{height}}',
      steps: '{{steps}}',
      cfg_scale: '{{cfg_scale}}',
      batch_count: '{{batch_count}}',
    },
    outputMapping: {
      assets: [
        {
          path: '$.output.images[*]',
          encoding: 'base64',
          mimeType: 'image/png',
          role: 'PRIMARY',
        },
        {
          path: '$.output.image_url',
          encoding: 'url',
          mimeType: 'image/png',
          role: 'PRIMARY',
        },
      ],
      progressPath: '$.output.progress',
      errorPath: '$.output.error_detail',
    },
    workflowTemplate: null,
    extraHeaders: {},
    settings: {
      timeoutMs: 120_000,
      pollIntervalMs: 2000,
      maxPollIntervalMs: 15_000,
      maxConcurrency: 2,
      costPerSecondUsd: 0.0005,
      costPerRequestUsd: 0.001,
      executionTimeoutMs: 600_000,
      ttlMs: 86_400_000,
      useWebhook: false,
    },
    isEnabled: true,
  };

  const job = {
    id: 'job_test_runpod_1',
    projectId: 'prj_1',
    modality: Modality.ICONS_2D,
    subMode: GenerationSubMode.STANDARD,
    rawPrompt: 'a glowing arcane crystal icon',
    providerModel: 'flux-1-dev',
    externalJobId: 'rp_ext_999',
    pollCount: 0,
  } as unknown as GenerationJob;

  const project = {
    id: 'prj_1',
    slug: 'astra-chronicles',
    name: 'Astra Chronicles',
  } as unknown as Project;

  return {
    job,
    project,
    provider,
    modality: Modality.ICONS_2D,
    subMode: GenerationSubMode.STANDARD,
    params: {
      modality: 'ICONS_2D',
      iconCategory: 'ITEM',
      frameShape: 'HEXAGON',
      removeBackground: true,
      solidBackgroundHex: null,
      outputSize: 1024,
      batchCount: 2,
      seed: 42,
    },
    compiled: {
      assetTitle: 'Arcane Crystal',
      enhancedPrompt: 'glowing arcane crystal icon, sharp facets, dark background',
      negativePrompt: 'blurry, text, watermark',
      recommendedParams: { steps: 30, cfg_scale: 6.5 },
      contextSourcesUsed: [],
      warnings: [],
    },
    mergedParams: {
      steps: 30,
      cfg_scale: 6.5,
    },
    seed: 42,
    references: [],
    voiceProfile: null,
    webhookUrl: null,
    signal: new AbortController().signal,
    reportProgress: jest.fn(),
    reportWorker: jest.fn(),
    log: jest.fn(),
    ...overrides,
  };
}

describe('RunPodServerlessAdapter', () => {
  let httpMock: jest.Mocked<Pick<HttpClientService, 'request'>>;
  let client: RunPodClient;
  let adapter: RunPodServerlessAdapter;

  beforeEach(() => {
    httpMock = {
      request: jest.fn(),
    };
    client = new RunPodClient(httpMock as unknown as HttpClientService);
    adapter = new RunPodServerlessAdapter(client);
  });

  it('detects cold start via /health when idle+running == 0 and wraps payload in { input }', async () => {
    httpMock.request
      .mockResolvedValueOnce({
        workers: { idle: 0, running: 0, initializing: 1, throttled: 0 },
      })
      .mockResolvedValueOnce({
        id: 'rp_job_101',
        status: 'IN_QUEUE',
      });

    const ctx = makeMockDispatchContext();
    const res = await adapter.submit(ctx);

    expect(res.mode).toBe('async');
    if (res.mode === 'async') {
      expect(res.externalJobId).toBe('rp_job_101');
      expect(res.initialStatus).toBe('COLD_START');
      expect(res.handle['warmAtSubmit']).toBe(false);
    }

    expect(httpMock.request).toHaveBeenCalledTimes(2);
    const runCall = httpMock.request.mock.calls[1]!;
    expect(runCall[0]).toBe('https://api.runpod.ai/v2/ep_flux_test/run');
    const body = runCall[1]?.body as Record<string, unknown>;
    expect(body['input']).toEqual({
      prompt: 'glowing arcane crystal icon, sharp facets, dark background',
      negative_prompt: 'blurry, text, watermark',
      seed: 42,
      width: 1024,
      height: 1024,
      steps: 30,
      cfg_scale: 6.5,
      batch_count: 2,
    });

    expect(ctx.reportWorker).toHaveBeenCalledWith(
      expect.objectContaining({
        externalJobId: 'rp_job_101',
        phase: 'COLD_START',
        coldStart: true,
      }),
    );
  });

  it('does not double-wrap when payloadTemplate already has a root "input" key', async () => {
    httpMock.request
      .mockResolvedValueOnce({
        workers: { idle: 2, running: 1, initializing: 0, throttled: 0 },
      })
      .mockResolvedValueOnce({
        id: 'rp_job_102',
        status: 'IN_QUEUE',
      });

    const ctx = makeMockDispatchContext();
    ctx.provider.payloadTemplate = {
      input: {
        custom_prompt: '{{enhanced_prompt}}',
        seed: '{{seed}}',
      },
    };

    const res = await adapter.submit(ctx);
    expect(res.mode).toBe('async');
    if (res.mode === 'async') {
      expect(res.initialStatus).toBe('RUNNING');
      expect(res.handle['warmAtSubmit']).toBe(true);
    }

    const runCall = httpMock.request.mock.calls[1]!;
    const body = runCall[1]?.body as Record<string, unknown>;
    expect(body['input']).toEqual({
      custom_prompt: 'glowing arcane crystal icon, sharp facets, dark background',
      seed: 42,
    });
  });

  it('throws VALIDATION_FAILED when required template variables are missing', async () => {
    const ctx = makeMockDispatchContext();
    ctx.provider.payloadTemplate = {
      prompt: '{{enhanced_prompt}}',
      missing_param: '{{non_existent_variable}}',
    };

    await expect(adapter.submit(ctx)).rejects.toThrow(DomainError);
    await expect(adapter.submit(ctx)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
      status: 400,
    });
  });

  it('polls through IN_QUEUE (cold start) -> IN_PROGRESS -> COMPLETED with base64 + url outputs and cost calculation', async () => {
    const ctx = makeMockDispatchContext();
    const handle = {
      endpointId: 'ep_flux_test',
      submittedAt: Date.now() - 5000,
      warmAtSubmit: false,
    };

    // 1. IN_QUEUE with initializing worker
    httpMock.request
      .mockResolvedValueOnce({
        id: 'rp_ext_999',
        status: 'IN_QUEUE',
        delayTime: 1800,
      })
      .mockResolvedValueOnce({
        workers: { idle: 0, running: 0, initializing: 1, throttled: 0 },
      });

    const poll1 = await adapter.poll(ctx, handle);
    expect(poll1).toEqual({
      state: 'pending',
      coldStart: true,
      externalStatus: 'IN_QUEUE',
      progress: 5,
      pollAfterMs: 3000,
      queueDelayMs: 1800,
    });

    // 2. IN_PROGRESS with progressPath extraction
    httpMock.request.mockResolvedValueOnce({
      id: 'rp_ext_999',
      status: 'IN_PROGRESS',
      delayTime: 2100,
      output: { progress: 64 },
    });

    const poll2 = await adapter.poll(ctx, handle);
    expect(poll2).toEqual({
      state: 'pending',
      coldStart: false,
      externalStatus: 'IN_PROGRESS',
      progress: 64,
      pollAfterMs: 2000,
      queueDelayMs: 2100,
    });

    // 3. COMPLETED with base64 and url outputs + executionTime cost calc
    httpMock.request.mockResolvedValueOnce({
      id: 'rp_ext_999',
      status: 'COMPLETED',
      delayTime: 2100,
      executionTime: 4000, // 4s * 0.0005 + 0.001 = 0.003
      output: {
        images: ['iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
        image_url: 'https://cdn.runpod.ai/outputs/test_icon.png',
      },
    });

    const poll3 = await adapter.poll(ctx, handle);
    expect(poll3.state).toBe('completed');
    if (poll3.state === 'completed') {
      expect(poll3.executionMs).toBe(4000);
      expect(poll3.queueDelayMs).toBe(2100);
      expect(poll3.costUsd).toBe(0.003);
      expect(poll3.outputs).toHaveLength(2);
      expect(poll3.outputs[0]).toMatchObject({
        kind: 'base64',
        mimeType: 'image/png',
        role: AssetFileRole.PRIMARY,
      });
      expect(poll3.outputs[1]).toMatchObject({
        kind: 'url',
        data: 'https://cdn.runpod.ai/outputs/test_icon.png',
        mimeType: 'image/png',
      });
    }
  });

  it('handles FAILED and TIMED_OUT status responses accurately', async () => {
    const ctx = makeMockDispatchContext();
    const handle = {
      endpointId: 'ep_flux_test',
      submittedAt: Date.now() - 10_000,
      warmAtSubmit: true,
    };

    httpMock.request.mockResolvedValueOnce({
      id: 'rp_ext_999',
      status: 'FAILED',
      output: { error_detail: 'CUDA out of memory on worker' },
    });

    const failedRes = await adapter.poll(ctx, handle);
    expect(failedRes).toEqual({
      state: 'failed',
      externalStatus: 'FAILED',
      code: ErrorCode.PROVIDER_ERROR,
      message: 'CUDA out of memory on worker',
      retryable: false,
    });

    httpMock.request.mockResolvedValueOnce({
      id: 'rp_ext_999',
      status: 'TIMED_OUT',
    });

    const timeoutRes = await adapter.poll(ctx, handle);
    expect(timeoutRes).toEqual({
      state: 'failed',
      externalStatus: 'TIMED_OUT',
      code: ErrorCode.PROVIDER_TIMEOUT,
      message: 'RunPod job timed out',
      retryable: true,
    });
  });

  it('extractMappedOutputs supports data_uri and text encodings', () => {
    const outputs = extractMappedOutputs(
      {
        output: {
          uri: 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
          shader: 'void fragment() { COLOR = vec4(1.0); }',
        },
      },
      {
        assets: [
          {
            path: '$.output.uri',
            encoding: 'data_uri',
            mimeType: 'image/png',
            role: 'PRIMARY',
          },
          {
            path: '$.output.shader',
            encoding: 'text',
            mimeType: 'text/plain',
            role: 'METADATA',
          },
        ],
      },
    );

    expect(outputs).toHaveLength(2);
    expect(outputs[0]).toMatchObject({
      kind: 'base64',
      mimeType: 'image/webp',
      data: 'UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=',
      role: AssetFileRole.PRIMARY,
    });
    expect(outputs[1]).toMatchObject({
      kind: 'text',
      mimeType: 'text/plain',
      data: 'void fragment() { COLOR = vec4(1.0); }',
      role: AssetFileRole.METADATA,
    });
  });
});
