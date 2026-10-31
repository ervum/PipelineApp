import { AssetFileRole } from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { ImageProcessingService } from '../../storage/image-processing.service';
import { ProcessedFileEntry } from './icon.post';

export interface SpritesheetPostProcessResult {
  primaryBuffer: Buffer;
  extraFiles: ProcessedFileEntry[];
  metadata: {
    width: number;
    height: number;
    frameCount: number;
    columns: number;
    rows: number;
    frameSize: number;
    fps: number;
  };
}

@Injectable()
export class SpritesheetPostProcessor {
  constructor(private readonly imageProc: ImageProcessingService) {}

  async process(
    sheetPng: Buffer,
    opts: {
      columns: number;
      rows: number;
      frameCount: number;
      frameSize: number;
      fps?: number;
      transparentBackground?: boolean;
      supportsNativeTransparency?: boolean;
    },
  ): Promise<SpritesheetPostProcessResult> {
    const processedSheet =
      opts.transparentBackground !== false && !opts.supportsNativeTransparency
        ? await this.imageProc.chromaKeyToAlpha(sheetPng)
        : sheetPng;

    const [probe, thumb, frames] = await Promise.all([
      this.imageProc.probe(processedSheet),
      this.imageProc.thumbnail(processedSheet, 384),
      this.imageProc.sliceSpritesheet(
        processedSheet,
        opts.columns,
        opts.rows,
        opts.frameCount,
      ),
    ]);

    const fps = opts.fps ?? 12;
    const cellW = Math.floor(probe.width / Math.max(1, opts.columns));
    const cellH = Math.floor(probe.height / Math.max(1, opts.rows));

    const metadata = {
      width: probe.width,
      height: probe.height,
      frameCount: frames.length,
      columns: opts.columns,
      rows: opts.rows,
      frameSize: opts.frameSize,
      fps,
    };

    const extraFiles: ProcessedFileEntry[] = [
      {
        role: AssetFileRole.THUMBNAIL,
        fileName: 'thumb.webp',
        mimeType: 'image/webp',
        buffer: thumb,
        width: 384,
        height: 384,
        format: 'webp',
      },
      {
        role: AssetFileRole.METADATA,
        fileName: 'spritesheet_meta.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(metadata, null, 2), 'utf8'),
        format: 'json',
      },
    ];

    for (let i = 0; i < frames.length; i++) {
      const idxStr = String(i + 1).padStart(3, '0');
      extraFiles.push({
        role: AssetFileRole.FRAME,
        fileName: `frame_${idxStr}.png`,
        mimeType: 'image/png',
        buffer: frames[i]!,
        width: cellW,
        height: cellH,
        format: 'png',
      });
    }

    return {
      primaryBuffer: processedSheet,
      extraFiles,
      metadata,
    };
  }
}
