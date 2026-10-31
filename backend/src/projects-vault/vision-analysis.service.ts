import { estimateTokens, HexColorSchema, VisionStatus } from '@forge/shared';
import { Inject, Injectable, Logger } from '@nestjs/common';
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

@Injectable()
export class VisionAnalysisService {
  private readonly logger = new Logger(VisionAnalysisService.name);
  private readonly queue: Array<{ fileId: string; middlemanProfileId?: string }> = [];
  private activeCount = 0;
  private readonly maxConcurrency = 2;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly providersService: ProvidersService,
    private readonly llmRegistry: LlmAdapterRegistry,
    @Inject(JOB_EVENTS_PUBLISHER) private readonly events: JobEventsPublisherPort,
  ) {}

  enqueue(fileId: string, middlemanProfileId?: string): void {
    this.queue.push({ fileId, middlemanProfileId });
    this.drainQueue();
  }

  private drainQueue(): void {
    while (this.activeCount < this.maxConcurrency && this.queue.length > 0) {
      const next = this.queue.shift()!;
      this.activeCount++;
      this.analyzeNow(next.fileId, next.middlemanProfileId)
        .catch((err) => {
          this.logger.warn(
            `Vision analysis failed for ${next.fileId}: ${err instanceof Error ? err.message : String(err)}`,
          );
        })
        .finally(() => {
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

    const running = await this.prisma.vaultFile.update({
      where: { id: fileId },
      data: {
        visionStatus: VisionStatus.RUNNING,
        visionError: null,
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
      const failed = await this.prisma.vaultFile.update({
        where: { id: fileId },
        data: {
          visionStatus: VisionStatus.FAILED,
          visionError: msg.slice(0, 500),
        },
        include: { folder: { select: { path: true } } },
      });
      this.events.vaultFileUpdated({
        projectId: failed.projectId,
        file: toVaultFileModel(failed),
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
