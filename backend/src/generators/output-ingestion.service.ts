import {
  ApprovalStatus,
  AssetFileRole,
  AssetMetadata,
  AssetModel,
  CompiledPrompt,
  ErrorCode,
  GenerationSubMode,
  Icons2DParams,
  JobStatus,
  Modality,
  ModalityParams,
} from '@forge/shared';
import { Inject, Injectable } from '@nestjs/common';
import { GenerationJob, Prisma, Project } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { DomainError } from '../common/errors/domain.error';
import { HttpClientService } from '../common/http/http-client.service';
import { toAssetModel } from '../common/mappers/asset.mapper';
import {
  extensionFromMime,
  extensionOf,
  sniffMimeFromBuffer,
} from '../common/utils/mime';
import {
  JOB_EVENTS_PUBLISHER,
  JobEventsPublisherPort,
} from '../orchestrator/job-events.port';
import { PrismaService } from '../prisma/prisma.service';
import { ProviderRuntimeConfig } from '../providers/providers.service';
import { ImageProcessingService } from '../storage/image-processing.service';
import { StorageKeys } from '../storage/storage-keys';
import { StorageService } from '../storage/storage.service';
import { CostEstimatorService } from './cost-estimator.service';
import { GeneratorOutput } from './generator-adapter.interface';
import { JobStateService } from './job-state.service';
import { AudioPostProcessor } from './post-processors/audio.post';
import {
  IconPostProcessor,
  ProcessedFileEntry,
} from './post-processors/icon.post';
import { Model3dPostProcessor } from './post-processors/model3d.post';
import { SpritesheetPostProcessor } from './post-processors/spritesheet.post';

const MAX_REMOTE_OUTPUT_BYTES = 200 * 1024 * 1024; // 200 MB cap

export interface IngestContext {
  job: GenerationJob;
  project: Project;
  provider: ProviderRuntimeConfig;
  params: ModalityParams;
  compiled: CompiledPrompt;
  outputs: GeneratorOutput[];
  supportsNativeTransparency: boolean;
  reportedCostUsd?: number | null;
  executionMs?: number | null;
  queueDelayMs?: number | null;
  coldStartMs?: number | null;
}

@Injectable()
export class OutputIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly imageProc: ImageProcessingService,
    private readonly http: HttpClientService,
    private readonly iconPost: IconPostProcessor,
    private readonly spritesheetPost: SpritesheetPostProcessor,
    private readonly model3dPost: Model3dPostProcessor,
    private readonly audioPost: AudioPostProcessor,
    private readonly costEstimator: CostEstimatorService,
    private readonly jobState: JobStateService,
    @Inject(JOB_EVENTS_PUBLISHER)
    private readonly eventsPublisher: JobEventsPublisherPort,
  ) {}

  async ingest(ctx: IngestContext): Promise<AssetModel[]> {
    if (ctx.outputs.length === 0) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'Generator returned zero outputs to ingest',
      );
    }

    // Group outputs by batchIndex
    const byBatch = new Map<number, GeneratorOutput[]>();
    for (const out of ctx.outputs) {
      const idx = out.batchIndex ?? 0;
      const list = byBatch.get(idx);
      if (list) {
        list.push(out);
      } else {
        byBatch.set(idx, [out]);
      }
    }
    const sortedBatchIndices = [...byBatch.keys()].sort((a, b) => a - b);

    const rawUserParams =
      typeof ctx.job.userParams === 'object' && ctx.job.userParams !== null
        ? (ctx.job.userParams as Record<string, unknown>)
        : {};
    const parentAssetId =
      typeof rawUserParams['__parentAssetId'] === 'string'
        ? rawUserParams['__parentAssetId']
        : null;

    // Determine lineage (assetGroupId & baseVersion) if parentAssetId is set
    let parentGroupId: string | null = null;
    let nextGroupVersion = 1;
    if (parentAssetId) {
      const parentAsset = await this.prisma.generatedAsset.findUnique({
        where: { id: parentAssetId },
        select: { assetGroupId: true },
      });
      if (parentAsset) {
        parentGroupId = parentAsset.assetGroupId;
        const maxVer = await this.prisma.generatedAsset.aggregate({
          where: { assetGroupId: parentGroupId },
          _max: { version: true },
        });
        nextGroupVersion = (maxVer._max.version ?? 0) + 1;
      }
    }

    const modality = ctx.job.modality as Modality;
    const subMode = ctx.job.subMode as GenerationSubMode;

    interface PreparedAssetData {
      assetId: string;
      assetGroupId: string;
      version: number;
      batchIndex: number;
      title: string;
      metadata: AssetMetadata;
      files: Array<{
        role: AssetFileRole;
        storageKey: string;
        fileName: string;
        mimeType: string;
        sizeBytes: number;
        width: number | null;
        height: number | null;
        durationMs: number | null;
        format: string;
        sortIndex: number;
      }>;
    }

    const preparedAssets: PreparedAssetData[] = [];

    for (let groupIdx = 0; groupIdx < sortedBatchIndices.length; groupIdx++) {
      const batchIndex = sortedBatchIndices[groupIdx]!;
      const groupOutputs = byBatch.get(batchIndex)!;

      const assetId = `ast_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const assetGroupId =
        parentGroupId ?? `grp_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
      const version = parentGroupId ? nextGroupVersion + groupIdx : 1;

      const primaryOut =
        groupOutputs.find((o) => o.role === AssetFileRole.PRIMARY) ??
        groupOutputs[0]!;
      const otherOutputs = groupOutputs.filter((o) => o !== primaryOut);

      let primaryBuf = await this.resolveBuffer(primaryOut, ctx.provider);
      let primaryMime = primaryOut.mimeType;
      if (
        !primaryMime ||
        primaryMime === 'application/octet-stream' ||
        primaryMime === 'binary/octet-stream'
      ) {
        primaryMime = sniffMimeFromBuffer(primaryBuf, primaryMime);
      }
      let primaryName = primaryOut.fileName;

      const filesToStore: ProcessedFileEntry[] = [];
      let metadata: AssetMetadata;

      if (modality === Modality.ICONS_2D) {
        const iconParams: Icons2DParams =
          ctx.params.modality === Modality.ICONS_2D
            ? ctx.params
            : {
                modality: 'ICONS_2D',
                iconCategory: 'ITEM',
                frameShape: 'NONE',
                outputSize: 1024,
                removeBackground: true,
                solidBackgroundHex: null,
                batchCount: 1,
                seed: null,
              };
        const res = await this.iconPost.process(
          primaryBuf,
          iconParams,
          ctx.supportsNativeTransparency,
        );
        primaryBuf = res.primaryBuffer;
        primaryMime = 'image/png';
        metadata = {
          modality: 'ICONS_2D',
          width: res.metadata.width,
          height: res.metadata.height,
          hasAlpha: res.metadata.hasAlpha,
          frameShape: res.metadata.frameShape,
          iconCategory: res.metadata.iconCategory,
        };

        filesToStore.push({
          role: AssetFileRole.PRIMARY,
          fileName: primaryName,
          mimeType: primaryMime,
          buffer: primaryBuf,
          width: res.metadata.width,
          height: res.metadata.height,
          format: 'png',
        });
        filesToStore.push(...res.extraFiles);
      } else if (modality === Modality.IMAGES) {
        const imgParams =
          ctx.params.modality === Modality.IMAGES ? ctx.params : null;
        const aspectPreset = imgParams?.aspectPreset ?? 'SQUARE_1_1';
        const isSeamless =
          aspectPreset === 'SEAMLESS_TILE' ||
          imgParams?.imageCategory === 'PBR_TEXTURE';

        let tileSeamScore: number | undefined;
        let unblendedSourceBuf: Buffer | null = null;
        if (isSeamless) {
          const seam = await this.imageProc.makeSeamless(primaryBuf);
          tileSeamScore = seam.seamScore;
          if (seam.blended) {
            unblendedSourceBuf = primaryBuf;
            primaryBuf = seam.buffer;
            primaryMime = 'image/png';
          }
        }

        const [probe, thumb] = await Promise.all([
          this.imageProc.probe(primaryBuf),
          this.imageProc.thumbnail(primaryBuf, 384),
        ]);

        metadata = {
          modality: 'IMAGES',
          width: probe.width,
          height: probe.height,
          aspectPreset,
          tileable: isSeamless,
          ...(tileSeamScore !== undefined ? { tileSeamScore } : {}),
        };

        filesToStore.push({
          role: AssetFileRole.PRIMARY,
          fileName: primaryName,
          mimeType: primaryMime,
          buffer: primaryBuf,
          width: probe.width,
          height: probe.height,
          format: probe.format,
        });
        filesToStore.push({
          role: AssetFileRole.THUMBNAIL,
          fileName: 'thumb.webp',
          mimeType: 'image/webp',
          buffer: thumb,
          width: 384,
          height: 384,
          format: 'webp',
        });
        if (unblendedSourceBuf) {
          filesToStore.push({
            role: AssetFileRole.SOURCE_REFERENCE,
            fileName: 'source_unblended.png',
            mimeType: 'image/png',
            buffer: unblendedSourceBuf,
            width: probe.width,
            height: probe.height,
            format: 'png',
          });
        }
      } else if (modality === Modality.VIDEO) {
        const vidParams =
          ctx.params.modality === Modality.VIDEO ? ctx.params : null;
        const outMeta = primaryOut.metadata ?? {};
        const width =
          typeof outMeta['width'] === 'number' ? outMeta['width'] : 1280;
        const height =
          typeof outMeta['height'] === 'number' ? outMeta['height'] : 720;
        const durationMs =
          typeof outMeta['durationMs'] === 'number'
            ? outMeta['durationMs']
            : Math.round((vidParams?.durationSec ?? 5) * 1000);
        const fps =
          typeof outMeta['fps'] === 'number'
            ? outMeta['fps']
            : (vidParams?.fps ?? 24);
        const aspectRatio =
          typeof outMeta['aspectRatio'] === 'string'
            ? outMeta['aspectRatio']
            : (vidParams?.aspectRatio ?? '16:9');
        const videoCategory =
          typeof outMeta['videoCategory'] === 'string'
            ? outMeta['videoCategory']
            : (vidParams?.videoCategory ?? 'CUTSCENE');
        const cameraMotion =
          typeof outMeta['cameraMotion'] === 'string'
            ? outMeta['cameraMotion']
            : (vidParams?.cameraMotion ?? 'STATIC');
        const loopable =
          typeof outMeta['loopable'] === 'boolean'
            ? outMeta['loopable']
            : (vidParams?.loopable ?? false);
        const hasAudio =
          typeof outMeta['hasAudio'] === 'boolean'
            ? outMeta['hasAudio']
            : (vidParams?.includeAudio ?? false);
        const memoryStrategy =
          typeof outMeta['memoryStrategy'] === 'string'
            ? outMeta['memoryStrategy']
            : (vidParams?.memoryStrategy ?? 'RAM_FALLBACK_32GB');

        metadata = {
          modality: 'VIDEO',
          width,
          height,
          durationMs,
          fps,
          aspectRatio,
          videoCategory,
          cameraMotion,
          loopable,
          hasAudio,
          memoryStrategy,
        };

        const ext =
          extensionOf(primaryName) || extensionFromMime(primaryMime, 'webp');
        filesToStore.push({
          role: AssetFileRole.PRIMARY,
          fileName: primaryName,
          mimeType: primaryMime,
          buffer: primaryBuf,
          width,
          height,
          durationMs,
          format: ext,
        });

        for (const extra of otherOutputs) {
          const extraBuf = await this.resolveBuffer(extra, ctx.provider);
          if (extra.role === AssetFileRole.THUMBNAIL) {
            const thumbWebp = await this.imageProc.thumbnail(extraBuf, 384);
            filesToStore.push({
              role: AssetFileRole.THUMBNAIL,
              fileName: 'thumb.webp',
              mimeType: 'image/webp',
              buffer: thumbWebp,
              width: 384,
              height: 384,
              format: 'webp',
            });
          } else {
            filesToStore.push({
              role: extra.role,
              fileName: extra.fileName,
              mimeType: extra.mimeType,
              buffer: extraBuf,
              format:
                extensionOf(extra.fileName) ||
                extensionFromMime(extra.mimeType, 'png'),
            });
          }
        }
      } else if (modality === Modality.LORE) {
        const loreParams =
          ctx.params.modality === Modality.LORE ? ctx.params : null;
        const outMeta = primaryOut.metadata ?? {};
        const rawText = primaryBuf.toString('utf8');
        const words = rawText
          .trim()
          .split(/\s+/)
          .filter((w) => w.length > 0);
        const wordCount =
          typeof outMeta['wordCount'] === 'number'
            ? outMeta['wordCount']
            : words.length;
        const charCount =
          typeof outMeta['charCount'] === 'number'
            ? outMeta['charCount']
            : rawText.length;
        const readingTimeSec =
          typeof outMeta['readingTimeSec'] === 'number'
            ? outMeta['readingTimeSec']
            : Math.max(5, Math.round((wordCount / 200) * 60));
        const lengthForm =
          outMeta['lengthForm'] === 'SHORT_FORM' ||
          outMeta['lengthForm'] === 'MEDIUM_FORM' ||
          outMeta['lengthForm'] === 'LONG_FORM'
            ? outMeta['lengthForm']
            : (loreParams?.lengthForm ?? 'SHORT_FORM');
        const loreCategory =
          typeof outMeta['loreCategory'] === 'string'
            ? outMeta['loreCategory']
            : (loreParams?.loreCategory ?? 'ITEM_DESCRIPTION');
        const tone =
          typeof outMeta['tone'] === 'string'
            ? outMeta['tone']
            : (loreParams?.tone ?? 'IN_WORLD_DIEGETIC');
        const perspective =
          typeof outMeta['perspective'] === 'string'
            ? outMeta['perspective']
            : (loreParams?.perspective ?? 'THIRD_PERSON_OMNISCIENT');
        const outputFormat =
          outMeta['outputFormat'] === 'PLAIN_TEXT'
            ? 'PLAIN_TEXT'
            : (loreParams?.outputFormat ?? 'MARKDOWN');
        const excerpt =
          typeof outMeta['excerpt'] === 'string'
            ? outMeta['excerpt']
            : rawText
                .replace(/[#>*_`~-]/g, ' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 220);

        metadata = {
          modality: 'LORE',
          lengthForm,
          loreCategory,
          tone,
          perspective,
          wordCount,
          charCount,
          readingTimeSec,
          outputFormat,
          excerpt,
        };

        const ext = outputFormat === 'PLAIN_TEXT' ? 'txt' : 'md';
        filesToStore.push({
          role: AssetFileRole.PRIMARY,
          fileName: primaryName || `lore.${ext}`,
          mimeType: outputFormat === 'PLAIN_TEXT' ? 'text/plain' : 'text/markdown',
          buffer: primaryBuf,
          format: ext,
        });
      } else if (
        modality === Modality.OTHER &&
        subMode === GenerationSubMode.SPRITESHEET
      ) {
        const spParams =
          ctx.params.modality === Modality.OTHER
            ? ctx.params.spritesheet
            : null;
        const columns = spParams?.columns ?? 4;
        const frameCount = spParams?.frameCount ?? 8;
        const rows = Math.max(1, Math.ceil(frameCount / columns));
        const frameSize = spParams?.frameSize ?? 128;
        const fps = spParams?.fps ?? 12;

        const res = await this.spritesheetPost.process(primaryBuf, {
          columns,
          rows,
          frameCount,
          frameSize,
          fps,
          transparentBackground: true,
          supportsNativeTransparency: ctx.supportsNativeTransparency,
        });
        primaryBuf = res.primaryBuffer;
        metadata = {
          modality: 'OTHER',
          subMode: GenerationSubMode.SPRITESHEET,
          frameCount: res.metadata.frameCount,
          columns: res.metadata.columns,
          frameSize: res.metadata.frameSize,
          fps: res.metadata.fps,
        };

        filesToStore.push({
          role: AssetFileRole.PRIMARY,
          fileName: primaryName,
          mimeType: 'image/png',
          buffer: primaryBuf,
          width: res.metadata.width,
          height: res.metadata.height,
          format: 'png',
        });
        filesToStore.push(...res.extraFiles);
      } else if (
        modality === Modality.OTHER &&
        subMode === GenerationSubMode.VFX_TEXTURE
      ) {
        const vfxParams =
          ctx.params.modality === Modality.OTHER ? ctx.params.vfx : null;
        let unblendedSourceBuf: Buffer | null = null;
        const seam = vfxParams?.tileable
          ? await this.imageProc.makeSeamless(primaryBuf)
          : await this.imageProc.makeTileable(primaryBuf);
        if ('blended' in seam && seam.blended) {
          unblendedSourceBuf = primaryBuf;
          primaryBuf = seam.buffer;
          primaryMime = 'image/png';
        }
        const [probe, thumb] = await Promise.all([
          this.imageProc.probe(primaryBuf),
          this.imageProc.thumbnail(primaryBuf, 384),
        ]);
        metadata = {
          modality: 'OTHER',
          subMode: GenerationSubMode.VFX_TEXTURE,
          frameSize: probe.width,
          tileSeamScore: seam.seamScore,
        };

        filesToStore.push({
          role: AssetFileRole.PRIMARY,
          fileName: primaryName,
          mimeType: primaryMime,
          buffer: primaryBuf,
          width: probe.width,
          height: probe.height,
          format: probe.format,
        });
        filesToStore.push({
          role: AssetFileRole.THUMBNAIL,
          fileName: 'thumb.webp',
          mimeType: 'image/webp',
          buffer: thumb,
          width: 384,
          height: 384,
          format: 'webp',
        });
        if (unblendedSourceBuf) {
          filesToStore.push({
            role: AssetFileRole.SOURCE_REFERENCE,
            fileName: 'source_unblended.png',
            mimeType: 'image/png',
            buffer: unblendedSourceBuf,
            width: probe.width,
            height: probe.height,
            format: 'png',
          });
        }
      } else if (modality === Modality.ASSETS_3D) {
        const meshMeta = this.model3dPost.inspectGlb(
          primaryBuf,
          primaryOut.metadata as Record<string, unknown> | undefined,
        );
        const params3d =
          ctx.params.modality === Modality.ASSETS_3D ? ctx.params : null;
        const ext = extensionOf(primaryName) || 'glb';
        metadata = {
          modality: 'ASSETS_3D',
          format: ext,
          triangleCount: meshMeta.triangleCount,
          vertexCount: meshMeta.vertexCount,
          textureResolution: params3d?.textureResolution ?? 2048,
          hasPbr: meshMeta.hasPbrTextures,
          boundingBox: meshMeta.boundingBox,
        };

        filesToStore.push({
          role: AssetFileRole.PRIMARY,
          fileName: primaryName,
          mimeType: primaryMime,
          buffer: primaryBuf,
          format: ext,
        });

        for (const extra of otherOutputs) {
          const extraBuf = await this.resolveBuffer(extra, ctx.provider);
          if (extra.role === AssetFileRole.THUMBNAIL) {
            const thumbWebp = await this.imageProc.thumbnail(extraBuf, 384);
            filesToStore.push({
              role: AssetFileRole.THUMBNAIL,
              fileName: 'thumb.webp',
              mimeType: 'image/webp',
              buffer: thumbWebp,
              width: 384,
              height: 384,
              format: 'webp',
            });
          } else {
            filesToStore.push({
              role: extra.role,
              fileName: extra.fileName,
              mimeType: extra.mimeType,
              buffer: extraBuf,
              format:
                extensionOf(extra.fileName) ||
                extensionFromMime(extra.mimeType),
            });
          }
        }

        if (!filesToStore.some((f) => f.role === AssetFileRole.THUMBNAIL)) {
          const autoThumb = await this.model3dPost.renderGlbThumbnail(
            primaryBuf,
            384,
          );
          if (autoThumb) {
            filesToStore.push({
              role: AssetFileRole.THUMBNAIL,
              fileName: 'thumb.webp',
              mimeType: 'image/webp',
              buffer: autoThumb,
              width: 384,
              height: 384,
              format: 'webp',
            });
          }
        }

        if (params3d?.generateLods !== false) {
          const lods = this.model3dPost.generateGlbLods(primaryBuf);
          if (lods.lod1) {
            filesToStore.push({
              role: AssetFileRole.LOD1,
              fileName: 'model_lod1.glb',
              mimeType: 'model/gltf-binary',
              buffer: lods.lod1,
              format: 'glb',
            });
          }
          if (lods.lod2) {
            filesToStore.push({
              role: AssetFileRole.LOD2,
              fileName: 'model_lod2.glb',
              mimeType: 'model/gltf-binary',
              buffer: lods.lod2,
              format: 'glb',
            });
          }
        }
      } else if (
        modality === Modality.MUSIC ||
        modality === Modality.VOICES ||
        modality === Modality.SFX
      ) {
        const audioMetaInput =
          modality === Modality.VOICES
            ? {
                ...(primaryOut.metadata ?? {}),
                transcript:
                  primaryOut.metadata?.['transcript'] ??
                  ctx.compiled.enhancedPrompt,
              }
            : primaryOut.metadata;
        const audioRes = this.audioPost.process(
          primaryBuf,
          primaryMime,
          primaryName,
          audioMetaInput,
        );
        primaryBuf = audioRes.primaryBuffer;
        primaryMime = audioRes.mimeType;
        primaryName = audioRes.fileName;

        const ext =
          extensionOf(primaryName) || extensionFromMime(primaryMime, 'wav');
        filesToStore.push({
          role: AssetFileRole.PRIMARY,
          fileName: primaryName,
          mimeType: primaryMime,
          buffer: primaryBuf,
          durationMs: audioRes.durationMs,
          format: ext,
        });
        filesToStore.push(...audioRes.extraFiles);

        const stemNames: string[] = [];
        for (const extra of otherOutputs) {
          const extraBuf = await this.resolveBuffer(extra, ctx.provider);
          const extraAudio = this.audioPost.process(
            extraBuf,
            extra.mimeType,
            extra.fileName,
            extra.metadata,
          );
          if (extra.role === AssetFileRole.STEM) {
            stemNames.push(extraAudio.fileName);
          }
          filesToStore.push({
            role: extra.role,
            fileName: extraAudio.fileName,
            mimeType: extraAudio.mimeType,
            buffer: extraAudio.primaryBuffer,
            durationMs: extraAudio.durationMs,
            format:
              extensionOf(extraAudio.fileName) ||
              extensionFromMime(extraAudio.mimeType, 'wav'),
          });
        }

        if (modality === Modality.MUSIC) {
          const musicParams =
            ctx.params.modality === Modality.MUSIC ? ctx.params : null;
          metadata = {
            modality: 'MUSIC',
            durationMs: audioRes.durationMs,
            bpm:
              (typeof primaryOut.metadata?.['bpm'] === 'number'
                ? primaryOut.metadata['bpm']
                : musicParams?.bpm) ?? null,
            keySignature:
              (typeof primaryOut.metadata?.['keySignature'] === 'string'
                ? primaryOut.metadata['keySignature']
                : musicParams?.keySignature) ?? null,
            loop: musicParams?.seamlessLoop ?? true,
            sampleRate: audioRes.sampleRate,
            stems: stemNames,
          };
        } else if (modality === Modality.SFX) {
          const sfxParams =
            ctx.params.modality === Modality.SFX ? ctx.params : null;
          metadata = {
            modality: 'SFX',
            durationMs: audioRes.durationMs,
            loopable: sfxParams?.loopable ?? false,
            variationIndex: batchIndex,
            sampleRate: audioRes.sampleRate,
          };
        } else {
          const voiceParams =
            ctx.params.modality === Modality.VOICES ? ctx.params : null;
          metadata = {
            modality: 'VOICES',
            durationMs: audioRes.durationMs,
            voiceProfileId: voiceParams?.voiceProfileId ?? null,
            transcript: ctx.compiled.enhancedPrompt,
            alignment: audioRes.alignment,
            sampleRate: audioRes.sampleRate,
          };
        }
      } else {
        // SHADER_CODE / LORE_JSON
        const outMeta = primaryOut.metadata ?? {};
        const lineCount =
          typeof outMeta['lineCount'] === 'number'
            ? outMeta['lineCount']
            : primaryBuf.toString('utf8').split(/\r?\n/).length;

        metadata = {
          modality: 'OTHER',
          subMode,
          ...(typeof outMeta['language'] === 'string'
            ? { language: outMeta['language'] }
            : {}),
          ...(typeof outMeta['schemaKind'] === 'string'
            ? { schemaKind: outMeta['schemaKind'] }
            : {}),
          lineCount,
        };

        const ext =
          extensionOf(primaryName) || extensionFromMime(primaryMime, 'txt');
        filesToStore.push({
          role: AssetFileRole.PRIMARY,
          fileName: primaryName,
          mimeType: primaryMime,
          buffer: primaryBuf,
          format: ext,
        });
      }

      // Upload all files for this asset to StorageService
      const uploadedFiles: PreparedAssetData['files'] = [];
      for (let fIdx = 0; fIdx < filesToStore.length; fIdx++) {
        const fileEntry = filesToStore[fIdx]!;
        const storageKey = StorageKeys.assetFile(
          ctx.project.slug,
          modality,
          assetId,
          version,
          fileEntry.fileName,
        );
        await this.storage.putBuffer(
          storageKey,
          fileEntry.buffer,
          fileEntry.mimeType,
        );
        uploadedFiles.push({
          role: fileEntry.role,
          storageKey,
          fileName: fileEntry.fileName,
          mimeType: fileEntry.mimeType,
          sizeBytes: fileEntry.buffer.length,
          width: fileEntry.width ?? null,
          height: fileEntry.height ?? null,
          durationMs: fileEntry.durationMs ?? null,
          format:
            fileEntry.format ||
            extensionOf(fileEntry.fileName) ||
            extensionFromMime(fileEntry.mimeType, 'bin'),
          sortIndex: fIdx,
        });
      }

      const baseTitle = ctx.compiled.assetTitle || 'Generated Asset';
      const title =
        sortedBatchIndices.length > 1
          ? `${baseTitle} #${groupIdx + 1}`
          : baseTitle;

      preparedAssets.push({
        assetId,
        assetGroupId,
        version,
        batchIndex,
        title,
        metadata,
        files: uploadedFiles,
      });
    }

    const totalCostUsd = this.costEstimator.estimate({
      provider: ctx.provider,
      batchCount: preparedAssets.length,
      executionMs: ctx.executionMs,
      reportedCostUsd: ctx.reportedCostUsd,
    });

    const perAssetCost =
      preparedAssets.length > 0
        ? Number((totalCostUsd / preparedAssets.length).toFixed(6))
        : 0;

    // Persist GeneratedAsset and GeneratedAssetFile rows in one transaction
    const createdAssets = await this.prisma.$transaction(async (tx) => {
      const rows = [];
      for (const prep of preparedAssets) {
        const created = await tx.generatedAsset.create({
          data: {
            id: prep.assetId,
            projectId: ctx.project.id,
            jobId: ctx.job.id,
            modality,
            subMode,
            title: prep.title,
            assetGroupId: prep.assetGroupId,
            version: prep.version,
            batchIndex: prep.batchIndex,
            parentAssetId,
            rawPrompt: ctx.job.rawPrompt,
            enhancedPrompt: ctx.compiled.enhancedPrompt,
            negativePrompt: ctx.compiled.negativePrompt,
            providerConfigId: ctx.provider.id,
            providerKind: ctx.provider.kind,
            providerModel: ctx.job.providerModel ?? ctx.provider.defaultModel,
            tier: ctx.provider.tier,
            seed:
              ctx.job.seed !== null ? ctx.job.seed + prep.batchIndex : null,
            costUsd: perAssetCost,
            executionMs: ctx.executionMs ?? null,
            approval: ApprovalStatus.DRAFT,
            isFavorite: false,
            tags: [],
            notes: '',
            metadata: prep.metadata as unknown as Prisma.InputJsonValue,
            files: {
              create: prep.files.map((f) => ({
                role: f.role,
                storageKey: f.storageKey,
                fileName: f.fileName,
                mimeType: f.mimeType,
                sizeBytes: f.sizeBytes,
                width: f.width,
                height: f.height,
                durationMs: f.durationMs,
                format: f.format,
                sortIndex: f.sortIndex,
              })),
            },
          },
          include: {
            files: true,
            savedToVault: { select: { id: true } },
          },
        });
        rows.push({
          ...created,
          providerName: ctx.provider.name,
        });
      }
      return rows;
    });

    const assetModels = createdAssets.map((r) => toAssetModel(r));

    await this.jobState.transition(
      ctx.job.id,
      JobStatus.COMPLETED,
      {
        progressPercent: 100,
        progressStage: 'completed',
        costUsd: totalCostUsd,
        ...(ctx.executionMs !== undefined
          ? { executionMs: ctx.executionMs }
          : {}),
        ...(ctx.queueDelayMs !== undefined
          ? { queueDelayMs: ctx.queueDelayMs }
          : {}),
        ...(ctx.coldStartMs !== undefined
          ? { coldStartMs: ctx.coldStartMs }
          : {}),
      },
      `Ingested ${assetModels.length} asset(s)`,
    );

    this.eventsPublisher.completed({
      jobId: ctx.job.id,
      projectId: ctx.project.id,
      assets: assetModels,
      costUsd: totalCostUsd,
      executionMs: ctx.executionMs ?? null,
    });

    return assetModels;
  }

  private async resolveBuffer(
    out: GeneratorOutput,
    provider: ProviderRuntimeConfig,
  ): Promise<Buffer> {
    if (out.kind === 'buffer') {
      return Buffer.isBuffer(out.data)
        ? out.data
        : Buffer.from(String(out.data));
    }
    if (out.kind === 'base64') {
      const str = String(out.data).replace(/^data:[^,]+,/, '').trim();
      return Buffer.from(str, 'base64');
    }
    if (out.kind === 'text') {
      return Buffer.from(String(out.data), 'utf8');
    }

    const url = String(out.data);
    const headers: Record<string, string> = {};
    if (
      provider.baseUrl &&
      url.startsWith(provider.baseUrl.replace(/\/$/, '')) &&
      provider.secret
    ) {
      headers['Authorization'] = `Bearer ${provider.secret}`;
    }

    const buf = await this.http.request<Buffer>(url, {
      method: 'GET',
      headers,
      responseType: 'buffer',
      timeoutMs: 90_000,
    });

    if (buf.length > MAX_REMOTE_OUTPUT_BYTES) {
      throw new DomainError(
        ErrorCode.PAYLOAD_TOO_LARGE,
        413,
        `Downloaded output exceeded 200 MB limit (${buf.length} bytes)`,
      );
    }

    return buf;
  }
}
