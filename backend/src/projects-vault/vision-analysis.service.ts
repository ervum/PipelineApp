import { estimateTokens, HexColorSchema, VisionStatus } from '@forge/shared';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { z } from 'zod';
import { toVaultFileModel } from '../common/mappers/vault.mapper';
import { extractAndParseJson } from '../middleman/compiled-output.parser';
import { LlmAdapterRegistry } from '../middleman/llm/llm-adapter.registry';
import {
  JOB_EVENTS_PUBLISHER,
  JobEventsPublisherPort,
} from '../orchestrator/job-events.port';
import { PrismaService } from '../prisma/prisma.service';
import { ProvidersService } from '../providers/providers.service';
import { StorageService } from '../storage/storage.service';

export const StyleDescriptorZodSchema = z.object({
  paletteHex: z.array(HexColorSchema).min(1).max(12),
  lighting: z.string(),
  rendering: z.string(),
  linework: z.string(),
  proportions: z.string(),
  materials: z.string(),
  composition: z.string(),
  mood: z.string(),
  doNot: z.array(z.string()).default([]),
});

const VisionOutputEnvelopeSchema = z.object({
  styleDescriptorText: z.string().min(40),
  descriptor: StyleDescriptorZodSchema,
});

const VISION_SYSTEM_PROMPT =
  'You are an art-direction analyst for a game studio. Extract reproducible visual rules from the reference image. Respond with JSON only.';

const VISION_USER_INSTRUCTION = [
  'Analyze the attached reference image and return a single JSON object with keys:',
  '- "styleDescriptorText": a dense 80–160 word paragraph usable verbatim inside an image-generation prompt describing palette, lighting, rendering, silhouette proportions, and materials.',
  '- "descriptor": {',
  '    "paletteHex": ["#RRGGBB", ...] (5 to 10 dominant colours as uppercase hex),',
  '    "lighting": string,',
  '    "rendering": string,',
  '    "linework": string,',
  '    "proportions": string,',
  '    "materials": string,',
  '    "composition": string,',
  '    "mood": string,',
  '    "doNot": string[]',
  '  }',
].join('\n');

const MAX_VISION_ATTEMPTS = 3;
const VISION_POLL_INTERVAL_MS = 2000;

@Injectable()
export class VisionAnalysisService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(VisionAnalysisService.name);
  private readonly queue: Array<{ fileId: string; middlemanProfileId?: string }> = [];
  private readonly inflightFileIds = new Set<string>();
  private activeCount = 0;
  private readonly maxConcurrency = 2;
  private pollTimer: NodeJS.Timeout | null = null;
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly providersService: ProvidersService,
    private readonly llmRegistry: LlmAdapterRegistry,
    @Inject(JOB_EVENTS_PUBLISHER) private readonly events: JobEventsPublisherPort,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    this.shuttingDown = false;
    try {
      await this.recover();
    } catch (err) {
      this.logger.warn(
        `Vision boot recovery warning: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    this.pollTimer = setInterval(() => {
      void this.pollPendingFromDb();
    }, VISION_POLL_INTERVAL_MS);
    this.pollTimer.unref?.();
  }

  onApplicationShutdown(): void {
    this.shuttingDown = true;
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  async recover(): Promise<void> {
    if (!this.prisma.vaultFile?.findMany) return;

    const interrupted = await this.prisma.vaultFile.findMany({
      where: {
        visionStatus: { in: [VisionStatus.RUNNING, VisionStatus.PENDING] },
      },
      include: { folder: { select: { path: true } } },
    });

    for (const file of interrupted) {
      if (file.visionStatus === VisionStatus.RUNNING) {
        if ((file.visionAttempts ?? 0) >= MAX_VISION_ATTEMPTS) {
          const failed = await this.prisma.vaultFile.update({
            where: { id: file.id },
            data: {
              visionStatus: VisionStatus.FAILED,
              visionError: `Exceeded max vision attempts (${MAX_VISION_ATTEMPTS}) across restarts`,
            },
            include: { folder: { select: { path: true } } },
          });
          this.events.vaultFileUpdated({
            projectId: failed.projectId,
            file: toVaultFileModel(failed),
          });
          continue;
        }
        await this.prisma.vaultFile.update({
          where: { id: file.id },
          data: { visionStatus: VisionStatus.PENDING },
        });
      }
      this.enqueue(file.id);
    }
  }

  enqueue(fileId: string, middlemanProfileId?: string): void {
    if (
      !this.inflightFileIds.has(fileId) &&
      !this.queue.some((q) => q.fileId === fileId)
    ) {
      this.queue.push({ fileId, middlemanProfileId });
    }
    this.drainQueue();
  }

  private async pollPendingFromDb(): Promise<void> {
    if (
      this.shuttingDown ||
      this.activeCount >= this.maxConcurrency ||
      !this.prisma.vaultFile?.findMany
    ) {
      return;
    }
    try {
      const pendingRows = await this.prisma.vaultFile.findMany({
        where: { visionStatus: VisionStatus.PENDING },
        orderBy: { updatedAt: 'asc' },
        take: this.maxConcurrency * 2,
        select: { id: true },
      });
      for (const row of pendingRows) {
        this.enqueue(row.id);
      }
    } catch {
      // Ignore transient poll errors
    }
  }

  private drainQueue(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      if (this.inflightFileIds.has(next.fileId)) {
        continue;
      }
      this.inflightFileIds.add(next.fileId);
      this.activeCount++;
      this.analyzeNow(next.fileId, next.middlemanProfileId)
        .catch((err) => {
          this.logger.warn(
            `Vision analysis failed for ${next.fileId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        })
        .finally(() => {
          this.inflightFileIds.delete(next.fileId);
          this.activeCount--;
          this.drainQueue();
        });
    }
  }

  async analyzeNow(fileId: string, explicitProfileId?: string): Promise<void> {
    const file = await this.prisma.vaultFile.findUnique({
      where: { id: fileId },
      include: { folder: { select: { path: true } } },
    });
    if (!file || !file.storageKey) {
      return;
    }

    const profile = await this.resolveVisionProfile(explicitProfileId);
    if (!profile) {
      const failed = await this.prisma.vaultFile.update({
        where: { id: fileId },
        data: {
          visionStatus: VisionStatus.FAILED,
          visionError: 'No vision-capable Middleman profile configured',
        },
        include: { folder: { select: { path: true } } },
      });
      this.events.vaultFileUpdated({
        projectId: failed.projectId,
        file: toVaultFileModel(failed),
      });
      return;
    }

    const nextAttempt = (file.visionAttempts ?? 0) + 1;
    const running = await this.prisma.vaultFile.update({
      where: { id: fileId },
      data: {
        visionStatus: VisionStatus.RUNNING,
        visionError: null,
        visionAttempts: nextAttempt,
      },
      include: { folder: { select: { path: true } } },
    });
    this.events.vaultFileUpdated({
      projectId: running.projectId,
      file: toVaultFileModel(running),
    });

    try {
      const rawBuf = await this.storage.getBuffer(file.storageKey);
      const downscaledJpeg = await sharp(rawBuf)
        .resize(1536, 1536, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      const providerRuntime = await this.providersService.getRuntimeConfig(
        profile.providerConfigId,
      );
      const adapter = this.llmRegistry.get(providerRuntime.kind);

      const completion = await adapter.complete(providerRuntime, {
        model: profile.model,
        system: VISION_SYSTEM_PROMPT,
        userParts: [
          {
            type: 'image',
            mimeType: 'image/jpeg',
            base64: downscaledJpeg.toString('base64'),
          },
          {
            type: 'text',
            text: VISION_USER_INSTRUCTION,
          },
        ],
        temperature: 0.2,
        maxOutputTokens: 1200,
        jsonMode: true,
      });

      const rawParsed = extractAndParseJson(completion.text);
      const validated = VisionOutputEnvelopeSchema.parse(rawParsed);
      const tokenEstimate = estimateTokens(validated.styleDescriptorText);

      const done = await this.prisma.vaultFile.update({
        where: { id: fileId },
        data: {
          styleDescriptorText: validated.styleDescriptorText,
          styleDescriptorJson: validated.descriptor as unknown as Prisma.InputJsonValue,
          visionStatus: VisionStatus.DONE,
          visionModel: profile.model,
          visionError: null,
          visionAnalyzedAt: new Date(),
          tokenEstimate,
        },
        include: { folder: { select: { path: true } } },
      });

      this.events.vaultFileUpdated({
        projectId: done.projectId,
        file: toVaultFileModel(done),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const shouldRequeue = nextAttempt < MAX_VISION_ATTEMPTS;
      const updated = await this.prisma.vaultFile.update({
        where: { id: fileId },
        data: {
          visionStatus: shouldRequeue
            ? VisionStatus.PENDING
            : VisionStatus.FAILED,
          visionError: msg.slice(0, 500),
        },
        include: { folder: { select: { path: true } } },
      });
      this.events.vaultFileUpdated({
        projectId: updated.projectId,
        file: toVaultFileModel(updated),
      });
    }
  }

  private async resolveVisionProfile(explicitProfileId?: string) {
    if (explicitProfileId) {
      const explicit = await this.prisma.middlemanProfile.findUnique({
        where: { id: explicitProfileId },
      });
      if (explicit && explicit.supportsVision) {
        return explicit;
      }
    }

    const visionDefault = await this.prisma.middlemanProfile.findFirst({
      where: { isVisionDefault: true, supportsVision: true },
    });
    if (visionDefault) {
      return visionDefault;
    }

    return this.prisma.middlemanProfile.findFirst({
      where: { supportsVision: true },
      orderBy: { isDefault: 'desc' },
    });
  }
}
