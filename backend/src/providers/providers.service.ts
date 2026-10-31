import {
  AdapterDescriptor,
  ErrorCode,
  ExecutionTier,
  GenerationSubMode,
  InterpolationResult,
  interpolateTemplate,
  MODALITIES,
  TERMINAL_JOB_STATUSES,
  Modality,
  ModelOption,
  OutputMapping,
  ParamSpec,
  ProviderCatalogEntry,
  ProviderConfigModel,
  ProviderKind,
  ProviderRole,
  ProviderSettings,
  TemplatePreviewDto,
  UpsertProviderDto,
  UpsertProviderSchema,
} from '@forge/shared';
import { Inject, Injectable, Optional } from '@nestjs/common';
import { AiProviderConfig, Prisma } from '@prisma/client';
import { DomainError } from '../common/errors/domain.error';
import { toProviderConfigModel } from '../common/mappers/provider.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { PROVIDER_CATALOG } from './provider-catalog';
import { SecretCipherService } from './secret-cipher.service';

export const GENERATOR_ADAPTER_REGISTRY_PORT = Symbol('GENERATOR_ADAPTER_REGISTRY_PORT');

export interface GeneratorAdapterRegistryPort {
  describeForProvider(provider: ProviderRuntimeConfig): AdapterDescriptor[];
  describe(
    kind: ProviderKind,
    modality: Modality,
    subMode: GenerationSubMode,
    provider?: ProviderRuntimeConfig,
  ): AdapterDescriptor;
}

export interface ResolvedProviderSettings extends ProviderSettings {
  timeoutMs: number;
  pollIntervalMs: number;
  maxPollIntervalMs: number;
  maxConcurrency: number;
  costPerSecondUsd: number;
  costPerRequestUsd: number;
  executionTimeoutMs: number;
  ttlMs: number;
  useWebhook: boolean;
}

export interface ProviderRuntimeConfig {
  id: string;
  name: string;
  kind: ProviderKind;
  tier: ExecutionTier;
  roles: ProviderRole[];
  modalities: Modality[];
  baseUrl: string | null;
  secret: string | null;
  runpodEndpointId: string | null;
  defaultModel: string | null;
  models: ModelOption[];
  payloadTemplate: Record<string, unknown> | null;
  outputMapping: OutputMapping | null;
  workflowTemplate: Record<string, unknown> | null;
  extraHeaders: Record<string, string>;
  settings: ResolvedProviderSettings;
  isEnabled: boolean;
}

export function defaultParamSpecsForModality(
  modality: Modality,
  subMode: GenerationSubMode = GenerationSubMode.STANDARD,
): ParamSpec[] {
  switch (modality) {
    case Modality.ICONS_2D:
      return [
        {
          key: 'guidance_scale',
          label: 'Guidance Scale',
          type: 'number',
          min: 1,
          max: 20,
          step: 0.5,
          default: 7.5,
          description: 'Prompt adherence strength',
          advanced: false,
        },
        {
          key: 'steps',
          label: 'Inference Steps',
          type: 'integer',
          min: 10,
          max: 60,
          step: 1,
          default: 28,
          description: 'Number of denoising steps',
          advanced: true,
        },
        {
          key: 'quality',
          label: 'Render Quality',
          type: 'enum',
          options: [
            { value: 'standard', label: 'Standard' },
            { value: 'hd', label: 'High Definition' },
          ],
          default: 'hd',
          description: 'Output quality preset',
          advanced: false,
        },
      ];
    case Modality.ASSETS_3D:
      return [
        {
          key: 'target_polycount',
          label: 'Target Polycount',
          type: 'integer',
          min: 500,
          max: 100000,
          step: 500,
          default: 8000,
          description: 'Target triangle budget for the generated mesh',
          advanced: false,
        },
        {
          key: 'texture_resolution',
          label: 'Texture Resolution',
          type: 'enum',
          options: [
            { value: '1024', label: '1024px' },
            { value: '2048', label: '2048px' },
            { value: '4096', label: '4096px' },
          ],
          default: '2048',
          description: 'PBR texture map resolution',
          advanced: false,
        },
        {
          key: 'art_style',
          label: 'Art Style',
          type: 'enum',
          options: [
            { value: 'realistic', label: 'Realistic PBR' },
            { value: 'stylized', label: 'Stylized Hand-Painted' },
          ],
          default: 'stylized',
          description: 'Surface shading style',
          advanced: false,
        },
      ];
    case Modality.IMAGES:
      return [
        {
          key: 'guidance_scale',
          label: 'Guidance Scale',
          type: 'number',
          min: 1,
          max: 20,
          step: 0.5,
          default: 7.0,
          description: 'Prompt adherence scale',
          advanced: false,
        },
        {
          key: 'steps',
          label: 'Steps',
          type: 'integer',
          min: 10,
          max: 60,
          step: 1,
          default: 30,
          description: 'Sampling step count',
          advanced: true,
        },
      ];
    case Modality.VIDEO:
      return [
        {
          key: 'guidance_scale',
          label: 'Motion & Prompt Guidance',
          type: 'number',
          min: 1,
          max: 15,
          step: 0.5,
          default: 6.0,
          description: 'Classifier-free guidance scale across temporal frames',
          advanced: false,
        },
        {
          key: 'steps',
          label: 'Temporal Denoising Steps',
          type: 'integer',
          min: 10,
          max: 50,
          step: 1,
          default: 24,
          description: 'Diffusion sampling steps per video clip',
          advanced: true,
        },
        {
          key: 'vram_offload_strategy',
          label: 'VRAM / 32GB DDR5 RAM Offload',
          type: 'enum',
          options: [
            { value: 'RAM_FALLBACK_32GB', label: '32GB DDR5 Shared RAM Fallback (Recommended)' },
            { value: 'LOW_VRAM_TILED', label: 'Tiled VAE + Layer Offload' },
            { value: 'AUTO', label: 'Automatic Driver Managed' },
            { value: 'VRAM_ONLY', label: 'Strict GPU VRAM Only' },
          ],
          default: 'RAM_FALLBACK_32GB',
          description: 'Offloads inactive diffusion blocks & VAE decoding to 32GB DDR5 system RAM when GPU VRAM fills up',
          advanced: false,
        },
      ];
    case Modality.LORE:
      return [
        {
          key: 'temperature',
          label: 'Narrative Creativity (Temp)',
          type: 'number',
          min: 0,
          max: 1.5,
          step: 0.05,
          default: 0.65,
          description: 'Sampling temperature for literary flair vs strict factual codex',
          advanced: false,
        },
        {
          key: 'top_p',
          label: 'Nucleus Sampling (Top-P)',
          type: 'number',
          min: 0.1,
          max: 1,
          step: 0.05,
          default: 0.92,
          description: 'Vocabulary diversity threshold',
          advanced: true,
        },
      ];
    case Modality.MUSIC:
      return [
        {
          key: 'bpm',
          label: 'Tempo (BPM)',
          type: 'integer',
          min: 50,
          max: 220,
          step: 1,
          default: 110,
          description: 'Target beats per minute',
          advanced: false,
        },
        {
          key: 'key_signature',
          label: 'Key Signature',
          type: 'string',
          default: 'D Dorian',
          description: 'Musical key and scale mode',
          advanced: false,
        },
        {
          key: 'duration_seconds',
          label: 'Duration (s)',
          type: 'integer',
          min: 5,
          max: 180,
          step: 1,
          default: 30,
          description: 'Clip duration in seconds',
          advanced: false,
        },
        {
          key: 'loop',
          label: 'Seamless Loop',
          type: 'boolean',
          default: true,
          description: 'Ensure loop-compatible cadence',
          advanced: false,
        },
      ];
    case Modality.VOICES:
      return [
        {
          key: 'instructions',
          label: 'Acting Instructions',
          type: 'string',
          default: 'Natural in-character delivery with clear articulation.',
          description: 'Acting direction for emotion, pace, and mic proximity',
          advanced: false,
        },
        {
          key: 'stability',
          label: 'Voice Stability',
          type: 'number',
          min: 0,
          max: 1,
          step: 0.05,
          default: 0.5,
          description: 'Consistency vs expressiveness',
          advanced: false,
        },
        {
          key: 'style',
          label: 'Style Exaggeration',
          type: 'number',
          min: 0,
          max: 1,
          step: 0.05,
          default: 0.35,
          description: 'Character style intensity',
          advanced: false,
        },
        {
          key: 'speed',
          label: 'Speech Speed',
          type: 'number',
          min: 0.7,
          max: 1.3,
          step: 0.05,
          default: 1.0,
          description: 'Pacing multiplier',
          advanced: false,
        },
      ];
    case Modality.SFX:
      return [
        {
          key: 'prompt_influence',
          label: 'Prompt Influence',
          type: 'number',
          min: 0,
          max: 1,
          step: 0.05,
          default: 0.65,
          description: 'How closely the generator follows the text prompt',
          advanced: false,
        },
      ];
    case Modality.OTHER:
      if (subMode === GenerationSubMode.SPRITESHEET || subMode === GenerationSubMode.VFX_TEXTURE) {
        return [
          {
            key: 'guidance_scale',
            label: 'Guidance Scale',
            type: 'number',
            min: 1,
            max: 20,
            step: 0.5,
            default: 7.5,
            description: 'Prompt adherence strength',
            advanced: false,
          },
        ];
      }
      return [
        {
          key: 'temperature',
          label: 'Temperature',
          type: 'number',
          min: 0,
          max: 1.5,
          step: 0.05,
          default: 0.2,
          description: 'Code/JSON sampling temperature',
          advanced: true,
        },
      ];
  }
}

export function buildFallbackAdapterDescriptor(
  providerKind: ProviderKind,
  modality: Modality,
  subMode: GenerationSubMode = GenerationSubMode.STANDARD,
): AdapterDescriptor {
  const supportsNegativePrompt =
    providerKind !== ProviderKind.GEMINI &&
    (modality === Modality.ICONS_2D ||
      modality === Modality.IMAGES ||
      modality === Modality.VIDEO ||
      modality === Modality.ASSETS_3D ||
      subMode === GenerationSubMode.SPRITESHEET ||
      subMode === GenerationSubMode.VFX_TEXTURE);

  return {
    adapterId: `${providerKind.toLowerCase()}-${modality.toLowerCase()}`,
    providerKind,
    modality,
    subModes: [subMode],
    supportsNegativePrompt,
    supportsSeed: true,
    supportsReferenceImage:
      modality === Modality.ICONS_2D ||
      modality === Modality.IMAGES ||
      modality === Modality.VIDEO ||
      modality === Modality.ASSETS_3D,
    supportsBatch:
      modality === Modality.ICONS_2D ||
      modality === Modality.IMAGES ||
      modality === Modality.LORE ||
      modality === Modality.SFX,
    maxPromptChars:
      modality === Modality.VOICES
        ? 1200
        : modality === Modality.LORE
          ? 4000
          : 2000,
    paramSpecs: defaultParamSpecsForModality(modality, subMode),
  };
}

@Injectable()
export class ProvidersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: SecretCipherService,
    @Optional()
    @Inject(GENERATOR_ADAPTER_REGISTRY_PORT)
    private adapterRegistry?: GeneratorAdapterRegistryPort,
  ) {}

  setAdapterRegistry(registry: GeneratorAdapterRegistryPort): void {
    this.adapterRegistry = registry;
  }

  catalog(): ProviderCatalogEntry[] {
    return PROVIDER_CATALOG;
  }

  async list(): Promise<ProviderConfigModel[]> {
    const rows = await this.prisma.aiProviderConfig.findMany({
      orderBy: [{ isEnabled: 'desc' }, { name: 'asc' }],
    });
    return rows.map(toProviderConfigModel);
  }

  async get(id: string): Promise<ProviderConfigModel> {
    const row = await this.findOrThrow(id);
    return toProviderConfigModel(row);
  }

  async getRuntimeConfig(id: string): Promise<ProviderRuntimeConfig> {
    const row = await this.findOrThrow(id);
    return this.toRuntimeConfig(row);
  }

  toRuntimeConfig(row: AiProviderConfig): ProviderRuntimeConfig {
    let decryptedSecret: string | null = null;
    if (row.encryptedSecret) {
      decryptedSecret = this.cipher.decrypt(row.encryptedSecret);
    }

    const rawSettings =
      typeof row.settings === 'object' && row.settings !== null && !Array.isArray(row.settings)
        ? (row.settings as Partial<ResolvedProviderSettings>)
        : {};

    const settings: ResolvedProviderSettings = {
      ...rawSettings,
      timeoutMs: rawSettings.timeoutMs ?? 120_000,
      pollIntervalMs: rawSettings.pollIntervalMs ?? 2000,
      maxPollIntervalMs: rawSettings.maxPollIntervalMs ?? 15_000,
      maxConcurrency: rawSettings.maxConcurrency ?? 2,
      costPerSecondUsd: rawSettings.costPerSecondUsd ?? 0,
      costPerRequestUsd: rawSettings.costPerRequestUsd ?? 0,
      executionTimeoutMs: rawSettings.executionTimeoutMs ?? 600_000,
      ttlMs: rawSettings.ttlMs ?? 86_400_000,
      useWebhook: rawSettings.useWebhook ?? false,
    };

    const models: ModelOption[] = Array.isArray(row.models)
      ? (row.models as unknown as ModelOption[])
      : [];

    const extraHeaders: Record<string, string> =
      typeof row.extraHeaders === 'object' &&
      row.extraHeaders !== null &&
      !Array.isArray(row.extraHeaders)
        ? (row.extraHeaders as Record<string, string>)
        : {};

    return {
      id: row.id,
      name: row.name,
      kind: row.kind as ProviderKind,
      tier: row.tier as ExecutionTier,
      roles: row.roles as ProviderRole[],
      modalities:
        row.kind === ProviderKind.DEMO
          ? [...MODALITIES]
          : (row.modalities as Modality[]),
      baseUrl: row.baseUrl,
      secret: decryptedSecret,
      runpodEndpointId: row.runpodEndpointId,
      defaultModel: row.defaultModel,
      models,
      payloadTemplate:
        typeof row.payloadTemplate === 'object' &&
        row.payloadTemplate !== null &&
        !Array.isArray(row.payloadTemplate)
          ? (row.payloadTemplate as Record<string, unknown>)
          : null,
      outputMapping:
        typeof row.outputMapping === 'object' && row.outputMapping !== null
          ? (row.outputMapping as unknown as OutputMapping)
          : null,
      workflowTemplate:
        typeof row.workflowTemplate === 'object' &&
        row.workflowTemplate !== null &&
        !Array.isArray(row.workflowTemplate)
          ? (row.workflowTemplate as Record<string, unknown>)
          : null,
      extraHeaders,
      settings,
      isEnabled: row.isEnabled,
    };
  }

  async create(dto: UpsertProviderDto): Promise<ProviderConfigModel> {
    const encryptedSecret =
      typeof dto.secret === 'string' && dto.secret.length > 0
        ? this.cipher.encrypt(dto.secret)
        : null;
    const secretLast4 =
      typeof dto.secret === 'string' && dto.secret.length > 0
        ? this.cipher.last4(dto.secret)
        : null;

    const created = await this.prisma.$transaction(async (tx) => {
      if (dto.defaultForModalities.length > 0) {
        await this.clearConflictingDefaults(tx, dto.defaultForModalities);
      }

      return tx.aiProviderConfig.create({
        data: {
          name: dto.name,
          kind: dto.kind,
          tier: dto.tier,
          roles: dto.roles,
          modalities: dto.modalities,
          baseUrl: dto.baseUrl ?? null,
          encryptedSecret,
          secretLast4,
          runpodEndpointId: dto.runpodEndpointId ?? null,
          defaultModel: dto.defaultModel ?? null,
          models: dto.models as unknown as Prisma.InputJsonValue,
          payloadTemplate: (dto.payloadTemplate ?? Prisma.DbNull) as Prisma.InputJsonValue,
          outputMapping: (dto.outputMapping ?? Prisma.DbNull) as Prisma.InputJsonValue,
          workflowTemplate: (dto.workflowTemplate ?? Prisma.DbNull) as Prisma.InputJsonValue,
          extraHeaders: dto.extraHeaders as Prisma.InputJsonValue,
          settings: dto.settings as Prisma.InputJsonValue,
          defaultForModalities: dto.defaultForModalities,
          isEnabled: dto.isEnabled,
        },
      });
    });

    return toProviderConfigModel(created);
  }

  async update(id: string, rawPatch: Record<string, unknown>): Promise<ProviderConfigModel> {
    const existing = await this.findOrThrow(id);
    const existingModel = toProviderConfigModel(existing);

    const mergedCandidate = {
      name: rawPatch['name'] ?? existingModel.name,
      kind: rawPatch['kind'] ?? existingModel.kind,
      tier: rawPatch['tier'] ?? existingModel.tier,
      roles: rawPatch['roles'] ?? existingModel.roles,
      modalities: rawPatch['modalities'] ?? existingModel.modalities,
      baseUrl: rawPatch['baseUrl'] !== undefined ? rawPatch['baseUrl'] : existingModel.baseUrl,
      secret: rawPatch['secret'],
      runpodEndpointId:
        rawPatch['runpodEndpointId'] !== undefined
          ? rawPatch['runpodEndpointId']
          : existingModel.runpodEndpointId,
      defaultModel:
        rawPatch['defaultModel'] !== undefined
          ? rawPatch['defaultModel']
          : existingModel.defaultModel,
      models: rawPatch['models'] ?? existingModel.models,
      payloadTemplate:
        rawPatch['payloadTemplate'] !== undefined
          ? rawPatch['payloadTemplate']
          : existingModel.payloadTemplate,
      outputMapping:
        rawPatch['outputMapping'] !== undefined
          ? rawPatch['outputMapping']
          : existingModel.outputMapping,
      workflowTemplate:
        rawPatch['workflowTemplate'] !== undefined
          ? rawPatch['workflowTemplate']
          : existingModel.workflowTemplate,
      extraHeaders: rawPatch['extraHeaders'] ?? existingModel.extraHeaders,
      settings:
        rawPatch['settings'] !== undefined
          ? { ...existingModel.settings, ...(rawPatch['settings'] as Record<string, unknown>) }
          : existingModel.settings,
      defaultForModalities:
        rawPatch['defaultForModalities'] ?? existingModel.defaultForModalities,
      isEnabled: rawPatch['isEnabled'] ?? existingModel.isEnabled,
    };

    const validated = UpsertProviderSchema.parse(mergedCandidate);

    let encryptedSecret = existing.encryptedSecret;
    let secretLast4 = existing.secretLast4;
    if (rawPatch['secret'] === null) {
      encryptedSecret = null;
      secretLast4 = null;
    } else if (typeof validated.secret === 'string' && validated.secret.length > 0) {
      encryptedSecret = this.cipher.encrypt(validated.secret);
      secretLast4 = this.cipher.last4(validated.secret);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (validated.defaultForModalities.length > 0) {
        await this.clearConflictingDefaults(tx, validated.defaultForModalities, id);
      }

      return tx.aiProviderConfig.update({
        where: { id },
        data: {
          name: validated.name,
          kind: validated.kind,
          tier: validated.tier,
          roles: validated.roles,
          modalities: validated.modalities,
          baseUrl: validated.baseUrl ?? null,
          encryptedSecret,
          secretLast4,
          runpodEndpointId: validated.runpodEndpointId ?? null,
          defaultModel: validated.defaultModel ?? null,
          models: validated.models as unknown as Prisma.InputJsonValue,
          payloadTemplate: (validated.payloadTemplate ?? Prisma.DbNull) as Prisma.InputJsonValue,
          outputMapping: (validated.outputMapping ?? Prisma.DbNull) as Prisma.InputJsonValue,
          workflowTemplate: (validated.workflowTemplate ?? Prisma.DbNull) as Prisma.InputJsonValue,
          extraHeaders: validated.extraHeaders as Prisma.InputJsonValue,
          settings: validated.settings as Prisma.InputJsonValue,
          defaultForModalities: validated.defaultForModalities,
          isEnabled: validated.isEnabled,
        },
      });
    });

    return toProviderConfigModel(updated);
  }

  async delete(id: string): Promise<void> {
    await this.findOrThrow(id);

    const activeJobsCount = await this.prisma.generationJob.count({
      where: {
        providerConfigId: id,
        status: { notIn: Array.from(TERMINAL_JOB_STATUSES) },
      },
    });
    if (activeJobsCount > 0) {
      throw new DomainError(
        ErrorCode.CONFLICT,
        409,
        `Cannot delete provider while referenced by ${activeJobsCount} active job(s)`,
      );
    }

    const totalJobsCount = await this.prisma.generationJob.count({
      where: { providerConfigId: id },
    });
    if (totalJobsCount > 0) {
      throw new DomainError(
        ErrorCode.CONFLICT,
        409,
        `Cannot delete provider referenced by ${totalJobsCount} historical job(s); disable it instead`,
      );
    }

    await this.prisma.aiProviderConfig.delete({ where: { id } });
  }

  async adapters(providerId: string): Promise<AdapterDescriptor[]> {
    const runtime = await this.getRuntimeConfig(providerId);
    if (!this.adapterRegistry) {
      return [];
    }
    return this.adapterRegistry.describeForProvider(runtime);
  }

  describeAdapterOrFallback(
    provider: ProviderRuntimeConfig,
    modality: Modality,
    subMode: GenerationSubMode = GenerationSubMode.STANDARD,
  ): AdapterDescriptor {
    if (this.adapterRegistry) {
      try {
        return this.adapterRegistry.describe(provider.kind, modality, subMode, provider);
      } catch {
        // Fallback when no generator adapter registered for this combination yet
      }
    }
    return buildFallbackAdapterDescriptor(provider.kind, modality, subMode);
  }

  previewTemplate(dto: TemplatePreviewDto): InterpolationResult {
    return interpolateTemplate(dto.template, dto.variables);
  }

  private async findOrThrow(id: string): Promise<AiProviderConfig> {
    const row = await this.prisma.aiProviderConfig.findUnique({ where: { id } });
    if (!row) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Provider config not found: ${id}`);
    }
    return row;
  }

  private async clearConflictingDefaults(
    tx: Prisma.TransactionClient,
    modalities: Modality[],
    excludeId?: string,
  ): Promise<void> {
    const conflicting = await tx.aiProviderConfig.findMany({
      where: {
        ...(excludeId ? { id: { not: excludeId } } : {}),
        defaultForModalities: { hasSome: modalities },
      },
    });

    for (const row of conflicting) {
      const filtered = row.defaultForModalities.filter((m) => !modalities.includes(m as Modality));
      await tx.aiProviderConfig.update({
        where: { id: row.id },
        data: { defaultForModalities: filtered },
      });
    }
  }
}
