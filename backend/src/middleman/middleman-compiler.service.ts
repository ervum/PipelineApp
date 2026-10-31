import {
  CompilePreviewDto,
  CompilePreviewResult,
  CompiledPrompt,
  ErrorCode,
  ExecutionMode,
  GenerationSubMode,
  JobStatus,
  LlmUsage,
  MiddlemanChunkEvent,
  Modality,
  ModalityParams,
  ModalityParamsSchema,
} from '@forge/shared';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { DomainError } from '../common/errors/domain.error';
import {
  JOB_EVENTS_PUBLISHER,
  JobEventsPublisherPort,
} from '../orchestrator/job-events.port';
import { PrismaService } from '../prisma/prisma.service';
import { VaultContextService } from '../projects-vault/vault-context.service';
import { ProvidersService } from '../providers/providers.service';
import { StorageService } from '../storage/storage.service';
import {
  COMPILED_PROMPT_JSON_SCHEMA,
  CompiledOutputParser,
  CompileParseContext,
} from './compiled-output.parser';
import { ContextAssemblerService } from './context-assembler.service';
import { LlmMessagePart } from './llm/llm-adapter.interface';
import { LlmAdapterRegistry } from './llm/llm-adapter.registry';
import { MiddlemanTemplatesService } from './middleman-templates.service';
import { SystemPromptBuilder } from './system-prompt.builder';

const STREAM_RING_BUFFER_CAPACITY = 400;
const CHUNK_EMIT_THROTTLE_MS = 40;

@Injectable()
export class MiddlemanStreamCache {
  private readonly buffers = new Map<string, MiddlemanChunkEvent[]>();

  push(jobId: string, chunk: MiddlemanChunkEvent): void {
    let list = this.buffers.get(jobId);
    if (!list) {
      list = [];
      this.buffers.set(jobId, list);
    }
    list.push(chunk);
    if (list.length > STREAM_RING_BUFFER_CAPACITY) {
      list.splice(0, list.length - STREAM_RING_BUFFER_CAPACITY);
    }
  }

  get(jobId: string): MiddlemanChunkEvent[] {
    return [...(this.buffers.get(jobId) ?? [])];
  }

  clear(jobId: string): void {
    this.buffers.delete(jobId);
  }
}

@Injectable()
export class MiddlemanCompilerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providersService: ProvidersService,
    private readonly templatesService: MiddlemanTemplatesService,
    private readonly vaultContextService: VaultContextService,
    private readonly contextAssembler: ContextAssemblerService,
    private readonly systemPromptBuilder: SystemPromptBuilder,
    private readonly outputParser: CompiledOutputParser,
    private readonly llmRegistry: LlmAdapterRegistry,
    private readonly storage: StorageService,
    private readonly streamCache: MiddlemanStreamCache,
    @Inject(JOB_EVENTS_PUBLISHER)
    private readonly eventsPublisher: JobEventsPublisherPort,
  ) {}

  /**
   * Stateless compile preview (does not create a job, does not stream to WebSockets).
   */
  async preview(dto: CompilePreviewDto): Promise<CompilePreviewResult> {
    const project = await this.prisma.project.findUnique({
      where: { id: dto.projectId },
    });
    if (!project) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Project "${dto.projectId}" not found`,
      );
    }

    const profile = dto.middlemanProfileId
      ? await this.prisma.middlemanProfile.findUnique({
          where: { id: dto.middlemanProfileId },
        })
      : await this.prisma.middlemanProfile.findFirst({
          where: { isDefault: true },
          orderBy: { createdAt: 'asc' },
        });

    if (!profile) {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        'No Middleman profile configured',
      );
    }

    const template = await this.templatesService.resolve(
      dto.projectId,
      dto.modality as Modality,
    );

    const generatorRuntime = await this.providersService.getRuntimeConfig(
      dto.providerConfigId,
    );
    const llmRuntime = await this.providersService.getRuntimeConfig(
      profile.providerConfigId,
    );

    const parsedParams = ModalityParamsSchema.parse(dto.params) as ModalityParams;
    const subMode =
      'subMode' in parsedParams
        ? (parsedParams.subMode as GenerationSubMode)
        : GenerationSubMode.STANDARD;

    const descriptor = this.providersService.describeAdapterOrFallback(
      generatorRuntime,
      dto.modality as Modality,
      subMode,
    );

    // Check voice profile if VOICES modality
    let voiceProfile: {
      id: string;
      name: string;
      description: string;
      characterSheetFileId: string | null;
    } | null = null;
    const pinnedFileIds = [...dto.pinnedFileIds];

    if (parsedParams.modality === 'VOICES' && parsedParams.voiceProfileId) {
      const vp = await this.prisma.voiceProfile.findUnique({
        where: { id: parsedParams.voiceProfileId },
      });
      if (vp && vp.projectId === dto.projectId) {
        voiceProfile = vp;
        if (
          vp.characterSheetFileId &&
          !pinnedFileIds.includes(vp.characterSheetFileId)
        ) {
          pinnedFileIds.unshift(vp.characterSheetFileId);
        }
      }
    }

    const { candidates, warnings: mentionWarnings } =
      await this.vaultContextService.collectCandidates(
        dto.projectId,
        dto.modality as Modality,
        pinnedFileIds,
        dto.rawPrompt,
      );

    const assembled = await this.contextAssembler.assemble(
      candidates,
      profile.maxContextTokens,
      {
        attachImages: profile.supportsVision && profile.attachReferenceImages,
        maxImages: profile.maxReferenceImages,
        globalSummary: project.globalSummary,
      },
    );

    const supportsNativeTransparency =
      generatorRuntime.kind === 'OPENAI' || generatorRuntime.kind === 'DEMO';

    const systemPrompt = this.systemPromptBuilder.build({
      template,
      descriptor,
      modality: dto.modality as Modality,
      params: parsedParams,
      project: { name: project.name, genre: project.genre },
      provider: {
        kind: generatorRuntime.kind,
        model: generatorRuntime.defaultModel,
        tier: generatorRuntime.tier,
      },
      supportsNativeTransparency,
      referenceImageAttached: assembled.imageParts.length > 0,
    });

    const userMessage = this.systemPromptBuilder.buildUserMessage({
      globalSummary: project.globalSummary,
      blocks: assembled.blocks,
      rawPrompt: dto.rawPrompt,
      params: parsedParams,
      voiceProfile: voiceProfile
        ? { name: voiceProfile.name, description: voiceProfile.description }
        : null,
    });

    const userParts: LlmMessagePart[] = [
      { type: 'text', text: userMessage },
      ...assembled.imageParts,
    ];

    const llmAdapter = this.llmRegistry.get(llmRuntime.kind);
    const startedMs = Date.now();
    const completion = await llmAdapter.complete(llmRuntime, {
      model: profile.model,
      system: systemPrompt,
      userParts,
      temperature: profile.temperature,
      maxOutputTokens: profile.maxOutputTokens,
      jsonMode: profile.jsonMode,
      jsonSchema: COMPILED_PROMPT_JSON_SCHEMA,
    });
    const latencyMs = Math.max(1, Date.now() - startedMs);

    const parseCtx: CompileParseContext = {
      availableFiles: assembled.included.map((f) => ({
        id: f.fileId,
        name: f.fileName,
      })),
      descriptor,
      defaultNegativePrompt: template.defaultNegativePrompt,
    };

    const compiled = await this.parseWithRepairRound(
      completion.text,
      parseCtx,
      llmAdapter,
      llmRuntime,
      profile.model,
    );

    for (const mw of mentionWarnings) {
      if (!compiled.warnings.includes(mw) && compiled.warnings.length < 10) {
        compiled.warnings.push(mw);
      }
    }

    const usage: LlmUsage = {
      inputTokens: completion.usage.inputTokens,
      outputTokens: completion.usage.outputTokens,
      latencyMs,
      model: profile.model,
    };

    return {
      compiled,
      systemPrompt,
      userMessage,
      contextFiles: assembled.included,
      droppedFiles: assembled.dropped,
      usage,
    };
  }

  /**
   * Full streaming compile for a persisted GenerationJob (§4.6.4).
   */
  async compileForJob(jobId: string, signal?: AbortSignal): Promise<CompiledPrompt> {
    const job = await this.prisma.generationJob.findUnique({
      where: { id: jobId },
      include: {
        project: true,
        providerConfig: true,
      },
    });
    if (!job) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Generation job "${jobId}" not found`,
      );
    }

    const profile = job.middlemanProfileId
      ? await this.prisma.middlemanProfile.findUnique({
          where: { id: job.middlemanProfileId },
        })
      : await this.prisma.middlemanProfile.findFirst({
          where: { isDefault: true },
          orderBy: { createdAt: 'asc' },
        });

    if (!profile) {
      await this.failJob(
        job.id,
        job.projectId,
        job.status as JobStatus,
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        'No Middleman profile configured',
      );
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        'No Middleman profile configured',
      );
    }

    const template = await this.templatesService.resolve(
      job.projectId,
      job.modality as Modality,
    );

    const generatorRuntime = await this.providersService.getRuntimeConfig(
      job.providerConfigId,
    );
    const llmRuntime = await this.providersService.getRuntimeConfig(
      profile.providerConfigId,
    );

    const rawParamsObj =
      typeof job.userParams === 'object' && job.userParams !== null
        ? (job.userParams as Record<string, unknown>)
        : { modality: job.modality };
    const parsedParams = ModalityParamsSchema.parse({
      modality: job.modality,
      ...rawParamsObj,
    }) as ModalityParams;

    const descriptor = this.providersService.describeAdapterOrFallback(
      generatorRuntime,
      job.modality as Modality,
      job.subMode as GenerationSubMode,
    );

    // Check voice profile characterSheetFileId
    let voiceProfile: {
      id: string;
      name: string;
      description: string;
      characterSheetFileId: string | null;
    } | null = null;
    const pinnedFileIds = [...job.pinnedFileIds];

    if (parsedParams.modality === 'VOICES' && parsedParams.voiceProfileId) {
      const vp = await this.prisma.voiceProfile.findUnique({
        where: { id: parsedParams.voiceProfileId },
      });
      if (vp && vp.projectId === job.projectId) {
        voiceProfile = vp;
        if (
          vp.characterSheetFileId &&
          !pinnedFileIds.includes(vp.characterSheetFileId)
        ) {
          pinnedFileIds.unshift(vp.characterSheetFileId);
        }
      }
    }

    const { candidates, warnings: mentionWarnings } =
      await this.vaultContextService.collectCandidates(
        job.projectId,
        job.modality as Modality,
        pinnedFileIds,
        job.rawPrompt,
      );

    const assembled = await this.contextAssembler.assemble(
      candidates,
      profile.maxContextTokens,
      {
        attachImages: profile.supportsVision && profile.attachReferenceImages,
        maxImages: profile.maxReferenceImages,
        globalSummary: job.project.globalSummary,
      },
    );

    const extraImageParts: LlmMessagePart[] = [...assembled.imageParts];
    if (profile.supportsVision && job.referenceStorageKeys.length > 0) {
      for (const refKey of job.referenceStorageKeys) {
        try {
          const buf = await this.storage.getBuffer(refKey);
          const downscaled = await sharp(buf)
            .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 85 })
            .toBuffer();
          extraImageParts.push({
            type: 'text',
            text: 'User-supplied reference image',
          });
          extraImageParts.push({
            type: 'image',
            mimeType: 'image/jpeg',
            base64: downscaled.toString('base64'),
          });
        } catch {
          // Non-fatal if reference image cannot be read
        }
      }
    }

    const supportsNativeTransparency =
      generatorRuntime.kind === 'OPENAI' || generatorRuntime.kind === 'DEMO';

    const systemPrompt = this.systemPromptBuilder.build({
      template,
      descriptor,
      modality: job.modality as Modality,
      params: parsedParams,
      project: { name: job.project.name, genre: job.project.genre },
      provider: {
        kind: generatorRuntime.kind,
        model: job.providerModel ?? generatorRuntime.defaultModel,
        tier: generatorRuntime.tier,
      },
      supportsNativeTransparency,
      referenceImageAttached: extraImageParts.length > 0,
    });

    const userMessage = this.systemPromptBuilder.buildUserMessage({
      globalSummary: job.project.globalSummary,
      blocks: assembled.blocks,
      rawPrompt: job.rawPrompt,
      params: parsedParams,
      voiceProfile: voiceProfile
        ? { name: voiceProfile.name, description: voiceProfile.description }
        : null,
    });

    // Step 6: Set middlemanStartedAt, middlemanProfileId, middlemanTemplateId, transition to COMPILING if needed
    const now = new Date();
    const prevStatus = job.status as JobStatus;
    await this.prisma.$transaction(async (tx) => {
      await tx.generationJob.update({
        where: { id: job.id },
        data: {
          status: JobStatus.COMPILING,
          middlemanProfileId: profile.id,
          middlemanTemplateId: template.id,
          middlemanStartedAt: now,
        },
      });
      if (prevStatus !== JobStatus.COMPILING) {
        await tx.generationJobEvent.create({
          data: {
            jobId: job.id,
            type: 'status',
            fromStatus: prevStatus,
            toStatus: JobStatus.COMPILING,
            message: `Compiling prompt with ${profile.name} (${profile.model})`,
          },
        });
      }
    });

    if (prevStatus !== JobStatus.COMPILING) {
      this.eventsPublisher.jobStatus({
        jobId: job.id,
        projectId: job.projectId,
        from: prevStatus,
        to: JobStatus.COMPILING,
        at: now.toISOString(),
        message: `Compiling prompt with ${profile.name} (${profile.model})`,
      });
    }

    this.streamCache.clear(job.id);

    const llmAdapter = this.llmRegistry.get(llmRuntime.kind);
    const userParts: LlmMessagePart[] = [
      { type: 'text', text: userMessage },
      ...extraImageParts,
    ];

    let rawBuffer = '';
    let pendingDelta = '';
    let seq = 0;
    let lastEmitMs = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    const startedMs = Date.now();

    const flushChunk = (force: boolean): void => {
      if (!pendingDelta) return;
      const nowMs = Date.now();
      if (!force && nowMs - lastEmitMs < CHUNK_EMIT_THROTTLE_MS) {
        return;
      }
      seq += 1;
      const chunkEvent: MiddlemanChunkEvent = {
        jobId: job.id,
        projectId: job.projectId,
        seq,
        delta: pendingDelta,
        accumulatedChars: rawBuffer.length,
      };
      pendingDelta = '';
      lastEmitMs = nowMs;
      this.streamCache.push(job.id, chunkEvent);
      this.eventsPublisher.middlemanChunk(chunkEvent);
    };

    try {
      for await (const ev of llmAdapter.stream(llmRuntime, {
        model: profile.model,
        system: systemPrompt,
        userParts,
        temperature: profile.temperature,
        maxOutputTokens: profile.maxOutputTokens,
        jsonMode: profile.jsonMode,
        jsonSchema: COMPILED_PROMPT_JSON_SCHEMA,
        signal,
      })) {
        if (ev.type === 'delta') {
          rawBuffer += ev.text;
          pendingDelta += ev.text;
          flushChunk(false);
        } else if (ev.type === 'done') {
          inputTokens = ev.usage.inputTokens;
          outputTokens = ev.usage.outputTokens;
        }
      }
      flushChunk(true);
    } catch (err) {
      const domainErr =
        err instanceof DomainError
          ? err
          : new DomainError(
              ErrorCode.PROVIDER_ERROR,
              502,
              err instanceof Error ? err.message : String(err),
            );
      const excerpt = rawBuffer.slice(0, 500);
      this.eventsPublisher.middlemanError({
        jobId: job.id,
        projectId: job.projectId,
        code: domainErr.code,
        message: domainErr.message,
        rawOutputExcerpt: excerpt,
      });
      await this.failJob(
        job.id,
        job.projectId,
        JobStatus.COMPILING,
        domainErr.code,
        domainErr.message,
      );
      throw domainErr;
    }

    const latencyMs = Math.max(1, Date.now() - startedMs);

    const parseCtx: CompileParseContext = {
      availableFiles: assembled.included.map((f) => ({
        id: f.fileId,
        name: f.fileName,
      })),
      descriptor,
      defaultNegativePrompt: template.defaultNegativePrompt,
    };

    let compiled: CompiledPrompt;
    try {
      compiled = await this.parseWithRepairRound(
        rawBuffer,
        parseCtx,
        llmAdapter,
        llmRuntime,
        profile.model,
        signal,
      );
    } catch (err) {
      const excerpt = rawBuffer.slice(0, 500);
      const message =
        err instanceof Error ? err.message : 'Middleman JSON parse failed';
      this.eventsPublisher.middlemanError({
        jobId: job.id,
        projectId: job.projectId,
        code: ErrorCode.MIDDLEMAN_PARSE_FAILED,
        message,
        rawOutputExcerpt: excerpt,
      });
      await this.failJob(
        job.id,
        job.projectId,
        JobStatus.COMPILING,
        ErrorCode.MIDDLEMAN_PARSE_FAILED,
        message,
        rawBuffer,
      );
      throw err instanceof DomainError
        ? err
        : new DomainError(ErrorCode.MIDDLEMAN_PARSE_FAILED, 502, message);
    }

    for (const mw of mentionWarnings) {
      if (!compiled.warnings.includes(mw) && compiled.warnings.length < 10) {
        compiled.warnings.push(mw);
      }
    }

    const usage: LlmUsage = {
      inputTokens,
      outputTokens,
      latencyMs,
      model: profile.model,
    };

    const nextStatus: 'AWAITING_REVIEW' | 'READY' =
      job.executionMode === ExecutionMode.INTERCEPT
        ? 'AWAITING_REVIEW'
        : 'READY';
    const nextJobStatus =
      nextStatus === 'AWAITING_REVIEW'
        ? JobStatus.AWAITING_REVIEW
        : JobStatus.READY;
    const completedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.generationJob.update({
        where: { id: job.id },
        data: {
          status: nextJobStatus,
          middlemanRawOutput: rawBuffer,
          compiledPayload: compiled as unknown as Prisma.InputJsonValue,
          contextFileIds: assembled.included.map((f) => f.fileId),
          middlemanUsage: usage as unknown as Prisma.InputJsonValue,
          middlemanCompletedAt: completedAt,
        },
      });
      await tx.generationJobEvent.create({
        data: {
          jobId: job.id,
          type: 'status',
          fromStatus: JobStatus.COMPILING,
          toStatus: nextJobStatus,
          message:
            nextStatus === 'AWAITING_REVIEW'
              ? 'Middleman compilation complete; awaiting review'
              : 'Middleman compilation complete; ready for dispatch',
          payload: {
            usage,
            contextCount: assembled.included.length,
          } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    this.eventsPublisher.middlemanComplete({
      jobId: job.id,
      projectId: job.projectId,
      compiled,
      contextFiles: assembled.included,
      usage,
      nextStatus,
    });

    this.eventsPublisher.jobStatus({
      jobId: job.id,
      projectId: job.projectId,
      from: JobStatus.COMPILING,
      to: nextJobStatus,
      at: completedAt.toISOString(),
      message:
        nextStatus === 'AWAITING_REVIEW'
          ? 'Middleman compilation complete; awaiting review'
          : 'Middleman compilation complete; ready for dispatch',
    });

    return compiled;
  }

  private async parseWithRepairRound(
    rawOutput: string,
    parseCtx: CompileParseContext,
    llmAdapter: ReturnType<LlmAdapterRegistry['get']>,
    llmRuntime: Awaited<ReturnType<ProvidersService['getRuntimeConfig']>>,
    model: string,
    signal?: AbortSignal,
  ): Promise<CompiledPrompt> {
    try {
      return this.outputParser.parse(rawOutput, parseCtx);
    } catch {
      const repairSystem = [
        'You fix malformed JSON. Return only valid JSON matching this contract:',
        '{"assetTitle": string, "enhancedPrompt": string, "negativePrompt": string, "recommendedParams": { [key]: string|number|boolean|null|string[] }, "contextSourcesUsed": [{"fileId": string, "fileName": string, "reasoningNote": string}], "warnings": string[]}',
      ].join('\n');

      const repaired = await llmAdapter.complete(llmRuntime, {
        model,
        system: repairSystem,
        userParts: [{ type: 'text', text: rawOutput }],
        temperature: 0,
        maxOutputTokens: 1600,
        jsonMode: true,
        jsonSchema: COMPILED_PROMPT_JSON_SCHEMA,
        signal,
      });

      return this.outputParser.parse(repaired.text, parseCtx);
    }
  }

  private async failJob(
    jobId: string,
    projectId: string,
    fromStatus: JobStatus,
    code: ErrorCode,
    message: string,
    middlemanRawOutput?: string,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.generationJob.update({
        where: { id: jobId },
        data: {
          status: JobStatus.FAILED,
          errorCode: code,
          errorMessage: message,
          completedAt: now,
          ...(middlemanRawOutput !== undefined ? { middlemanRawOutput } : {}),
        },
      });
      await tx.generationJobEvent.create({
        data: {
          jobId,
          type: 'status',
          fromStatus,
          toStatus: JobStatus.FAILED,
          message,
          payload: { code } as unknown as Prisma.InputJsonValue,
        },
      });
    });

    this.eventsPublisher.jobStatus({
      jobId,
      projectId,
      from: fromStatus,
      to: JobStatus.FAILED,
      at: now.toISOString(),
      message,
    });

    this.eventsPublisher.failed({
      jobId,
      projectId,
      code,
      message,
      retryable: true,
    });
  }
}
