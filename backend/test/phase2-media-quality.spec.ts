import sharp from 'sharp';
import { AudioPostProcessor } from '../src/generators/post-processors/audio.post';
import { IconPostProcessor } from '../src/generators/post-processors/icon.post';
import { Model3dPostProcessor } from '../src/generators/post-processors/model3d.post';
import { ImageProcessingService } from '../src/storage/image-processing.service';
import {
  createRingIconWithIslandPng,
  createSampleGlbBuffer,
  createSampleObjBuffer,
  createSampleWavBuffer,
  createSeamedTilePng,
} from './fixtures/media-fixtures';

describe('Phase 2 — Media Post-Processing Quality', () => {
  const imageProc = new ImageProcessingService();
  const iconPost = new IconPostProcessor(imageProc);
  const audioPost = new AudioPostProcessor();
  const model3dPost = new Model3dPostProcessor();

  describe('2.1 IconPostProcessor frameShape & solidBackgroundHex', () => {
    it('applies HEXAGON frame clipping mask so outer corner pixels are transparent', async () => {
      const solidRed = await sharp({
        create: {
          width: 128,
          height: 128,
          channels: 4,
          background: { r: 220, g: 50, b: 50, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const res = await iconPost.process(
        solidRed,
        {
          modality: 'ICONS_2D',
          iconCategory: 'ITEM',
          frameShape: 'HEXAGON',
          frameStrokeHex: '#FFFFFF',
          removeBackground: false,
          bgRemovalTolerance: 38,
          solidBackgroundHex: null,
          outputSize: 512,
          batchCount: 1,
          seed: null,
        },
        true,
      );

      const { data, info } = await sharp(res.primaryBuffer)
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(info.width).toBe(512);
      expect(info.height).toBe(512);

      // Corner (4, 4) lies outside the hexagon mask -> alpha = 0
      const cornerAlpha = data[(4 * info.width + 4) * 4 + 3]!;
      expect(cornerAlpha).toBe(0);

      // Center (256, 256) lies inside the hexagon mask -> alpha = 255
      const centerAlpha = data[(256 * info.width + 256) * 4 + 3]!;
      expect(centerAlpha).toBe(255);
    });

    it('composites onto solidBackgroundHex when removeBackground is false', async () => {
      const ringPng = await createRingIconWithIslandPng(128);
      const keyed = await imageProc.chromaKeyToAlpha(ringPng, { tolerance: 38 });

      const res = await iconPost.process(
        keyed,
        {
          modality: 'ICONS_2D',
          iconCategory: 'ITEM',
          frameShape: 'NONE',
          frameStrokeHex: null,
          removeBackground: false,
          bgRemovalTolerance: 38,
          solidBackgroundHex: '#1E1B4B',
          outputSize: 512,
          batchCount: 1,
          seed: null,
        },
        true,
      );

      const { data, info } = await sharp(res.primaryBuffer)
        .raw()
        .toBuffer({ resolveWithObject: true });
      const idx = (4 * info.width + 4) * 4;
      expect(data[idx]).toBeCloseTo(0x1e, -1);
      expect(data[idx + 1]).toBeCloseTo(0x1b, -1);
      expect(data[idx + 2]).toBeCloseTo(0x4b, -1);
      expect(data[idx + 3]).toBe(255);
    });
  });

  describe('2.2 CIELAB ΔE chroma-key + interior enclosed-island removal', () => {
    it('removes both outer background and enclosed interior background island inside a ring icon', async () => {
      const ringPng = await createRingIconWithIslandPng(128);
      const keyedBuf = await imageProc.chromaKeyToAlpha(ringPng, {
        tolerance: 38,
      });

      const { data, info } = await sharp(keyedBuf)
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Outer corner (2, 2) -> transparent
      expect(data[(2 * info.width + 2) * 4 + 3]).toBe(0);
      // Enclosed center island (64, 64) -> transparent
      expect(data[(64 * info.width + 64) * 4 + 3]).toBe(0);
      // Ring body (64, 24) -> opaque
      expect(data[(24 * info.width + 64) * 4 + 3]).toBe(255);
    });
  });

  describe('2.3 Seamless tile edge synthesis (makeSeamless)', () => {
    it('blends opposite borders and significantly reduces tile seamScore', async () => {
      const seamedPng = await createSeamedTilePng(128);
      const before = await imageProc.makeTileable(seamedPng);
      expect(before.seamScore).toBeGreaterThan(20);

      const seamless = await imageProc.makeSeamless(seamedPng, 0.18);
      expect(seamless.blended).toBe(true);
      expect(seamless.seamScore).toBeLessThan(before.seamScore);
    });
  });

  describe('2.4 AudioPostProcessor MP3/OGG probe + estimated word alignment', () => {
    it('computes monotonic estimated word timestamps from WAV envelope when provider omits alignment', () => {
      const wavBuf = createSampleWavBuffer(1.2);
      const res = audioPost.process(wavBuf, 'audio/wav', 'line.wav', {
        transcript: 'Forged in the heart of a dying star',
      });

      expect(res.alignment).not.toBeNull();
      expect(res.alignment?.source).toBe('ESTIMATED');
      expect(res.alignment?.words.length).toBe(8);

      let prevStart = -1;
      for (const w of res.alignment!.words) {
        expect(w.startMs).toBeGreaterThanOrEqual(prevStart);
        expect(w.endMs).toBeGreaterThan(w.startMs);
        prevStart = w.startMs;
      }
    });
  });

  describe('2.5 & 2.6 Model3dPostProcessor .obj inspection, GLB thumbnail, and LOD generation', () => {
    it('inspects Wavefront .obj geometry metrics accurately', () => {
      const objBuf = createSampleObjBuffer();
      const meta = model3dPost.inspectGlb(objBuf);

      expect(meta.vertexCount).toBe(5);
      expect(meta.triangleCount).toBe(6);
      expect(meta.hasPbrTextures).toBe(true);
      expect(meta.boundingBox[0]).toBeGreaterThan(0);
    });

    it('renders a 384x384 WebP thumbnail from a binary .glb buffer', async () => {
      const glbBuf = createSampleGlbBuffer();
      const thumb = await model3dPost.renderGlbThumbnail(glbBuf, 384);

      expect(thumb).not.toBeNull();
      const meta = await sharp(thumb!).metadata();
      expect(meta.format).toBe('webp');
      expect(meta.width).toBe(384);
      expect(meta.height).toBe(384);
    });

    it('generates valid binary LOD1 and LOD2 .glb buffers with reduced triangle counts', () => {
      const glbBuf = createSampleGlbBuffer();
      const baseMeta = model3dPost.inspectGlb(glbBuf);
      expect(baseMeta.triangleCount).toBeGreaterThan(20);

      const lods = model3dPost.generateGlbLods(glbBuf);
      expect(lods.lod1).toBeDefined();
      expect(lods.lod2).toBeDefined();

      const lod1Meta = model3dPost.inspectGlb(lods.lod1!);
      const lod2Meta = model3dPost.inspectGlb(lods.lod2!);
      expect(lod1Meta.triangleCount).toBeLessThan(baseMeta.triangleCount);
      expect(lod2Meta.triangleCount).toBeLessThan(lod1Meta.triangleCount);
      expect(lod2Meta.triangleCount).toBeGreaterThanOrEqual(1);
    });
  });
});
