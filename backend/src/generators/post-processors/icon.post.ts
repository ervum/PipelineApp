import { AssetFileRole, Icons2DParams } from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { ImageProcessingService } from '../../storage/image-processing.service';

export interface ProcessedFileEntry {
  role: AssetFileRole;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  width?: number | null;
  height?: number | null;
  durationMs?: number | null;
  format?: string | null;
}

export interface IconPostProcessResult {
  primaryBuffer: Buffer;
  extraFiles: ProcessedFileEntry[];
  metadata: {
    width: number;
    height: number;
    hasAlpha: boolean;
    frameShape: string;
    iconCategory: string;
  };
}

@Injectable()
export class IconPostProcessor {
  constructor(private readonly imageProc: ImageProcessingService) {}

  async process(
    rawPng: Buffer,
    params: Icons2DParams,
    supportsNativeTransparency: boolean,
  ): Promise<IconPostProcessResult> {
    const removeBg = params.removeBackground !== false;
    const tolerance = params.bgRemovalTolerance ?? 38;
    let processed =
      removeBg && !supportsNativeTransparency
        ? await this.imageProc.chromaKeyToAlpha(rawPng, { tolerance })
        : rawPng;

    if (!removeBg && params.solidBackgroundHex) {
      processed = await this.imageProc.applySolidBackground(
        processed,
        params.solidBackgroundHex,
      );
    }

    if (params.frameShape && params.frameShape !== 'NONE') {
      processed = await this.imageProc.applyFrameMask(
        processed,
        params.frameShape,
        params.frameStrokeHex ?? null,
      );
    }

    const [probe, variants, thumb] = await Promise.all([
      this.imageProc.probe(processed),
      this.imageProc.iconVariants(processed),
      this.imageProc.thumbnail(processed, 256),
    ]);

    if (
      params.outputSize &&
      (probe.width !== params.outputSize || probe.height !== params.outputSize)
    ) {
      processed =
        params.outputSize === 512
          ? variants[512]
          : await this.imageProc.resizeSquare(processed, params.outputSize);
      probe.width = params.outputSize;
      probe.height = params.outputSize;
    }

    const extraFiles: ProcessedFileEntry[] = [
      {
        role: AssetFileRole.THUMBNAIL,
        fileName: 'thumb.webp',
        mimeType: 'image/webp',
        buffer: thumb,
        width: 256,
        height: 256,
        format: 'webp',
      },
      {
        role: AssetFileRole.VARIANT_512,
        fileName: 'icon_512.png',
        mimeType: 'image/png',
        buffer: variants[512],
        width: 512,
        height: 512,
        format: 'png',
      },
      {
        role: AssetFileRole.VARIANT_128,
        fileName: 'icon_128.png',
        mimeType: 'image/png',
        buffer: variants[128],
        width: 128,
        height: 128,
        format: 'png',
      },
      {
        role: AssetFileRole.VARIANT_64,
        fileName: 'icon_64.png',
        mimeType: 'image/png',
        buffer: variants[64],
        width: 64,
        height: 64,
        format: 'png',
      },
      {
        role: AssetFileRole.VARIANT_32,
        fileName: 'icon_32.png',
        mimeType: 'image/png',
        buffer: variants[32],
        width: 32,
        height: 32,
        format: 'png',
      },
    ];

    return {
      primaryBuffer: processed,
      extraFiles,
      metadata: {
        width: probe.width,
        height: probe.height,
        hasAlpha: probe.hasAlpha,
        frameShape: params.frameShape ?? 'NONE',
        iconCategory: params.iconCategory ?? 'ITEM',
      },
    };
  }
}
