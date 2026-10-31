import {
  ApprovalStatus,
  AssetFileRole,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ProviderKind,
} from '@forge/shared';
import sharp from 'sharp';
import { AssetsService } from '../src/assets/assets.service';
import { ImageProcessingService } from '../src/storage/image-processing.service';
import { encodeWavPcm16, editWavAudio } from '../src/synth/wav-audio.synth';

describe('Phase 4 — In-Stage Editing & Refinement Tools', () => {
  const imageProc = new ImageProcessingService();

  describe('4.1 AssetsService.reviseTextAsset (LORE, SHADER_CODE, LORE_JSON)', () => {
    it('creates a new version in assetGroupId with updated wordCount/lineCount and validates LORE_JSON syntax', async () => {
      const putBuffers: Array<{ key: string; buf: Buffer }> = [];
      let createdAssetData: Record<string, unknown> | null = null;

      const prismaMock = {
        generatedAsset: {
          findUnique: jest.fn(async ({ where }: { where: { id: string } }) => ({
            id: where.id,
            projectId: 'proj_1',
            jobId: 'job_1',
            modality: where.id === 'ast_json' ? Modality.OTHER : Modality.LORE,
            subMode:
              where.id === 'ast_json'
                ? GenerationSubMode.LORE_JSON
                : GenerationSubMode.STANDARD,
            title: 'Ancient Obelisk',
            assetGroupId: 'grp_obelisk',
            version: 1,
            batchIndex: 0,
            parentAssetId: null,
            rawPrompt: 'Ancient obelisk lore',
            enhancedPrompt: 'Ancient obelisk lore',
            negativePrompt: '',
            providerConfigId: 'prov_1',
            providerKind: ProviderKind.DEMO,
            providerModel: 'demo-v1',
            tier: ExecutionTier.FREE,
            seed: 42,
            approval: ApprovalStatus.DRAFT,
            isFavorite: false,
            tags: ['lore'],
            notes: '',
            metadata: {
              modality: 'LORE',
              lengthForm: 'SHORT_FORM',
              loreCategory: 'ITEM_DESCRIPTION',
              tone: 'IN_WORLD_DIEGETIC',
              perspective: 'THIRD_PERSON_OMNISCIENT',
              wordCount: 5,
              charCount: 30,
              readingTimeSec: 5,
              outputFormat: 'MARKDOWN',
              excerpt: 'Old text',
            },
            project: { id: 'proj_1', slug: 'astra' },
            files: [
              {
                id: 'file_1',
                role: AssetFileRole.PRIMARY,
                storageKey: 'astra/LORE/ast_1/v1/lore.md',
                fileName: 'lore.md',
                mimeType: 'text/markdown',
                format: 'md',
              },
            ],
          })),
          aggregate: jest.fn(async () => ({ _max: { version: 2 } })),
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
            createdAssetData = data;
            return {
              ...data,
              createdAt: new Date(),
              savedToVault: null,
              files: [
                {
                  id: 'file_2',
                  role: AssetFileRole.PRIMARY,
                  storageKey: 'astra/LORE/ast_2/v3/lore.md',
                  fileName: 'lore.md',
                  mimeType: 'text/markdown',
                  sizeBytes: 64,
                  width: null,
                  height: null,
                  durationMs: null,
                  format: 'md',
                  sortIndex: 0,
                },
              ],
            };
          }),
        },
        aiProviderConfig: {
          findMany: jest.fn(async () => [{ id: 'prov_1', name: 'Demo Studio' }]),
        },
      };

      const storageMock = {
        putBuffer: jest.fn(async (key: string, buf: Buffer) => {
          putBuffers.push({ key, buf });
        }),
      };

      const service = new AssetsService(
        prismaMock as never,
        storageMock as never,
        imageProc,
        {} as never,
        {} as never,
        {} as never,
      );

      const revised = await service.reviseTextAsset('ast_lore', {
        contentText: '# The Obelisk of Dawn\nCarved from starlight and obsidian stone.',
      });

      expect(revised.version).toBe(3);
      expect(revised.parentAssetId).toBe('ast_lore');
      expect(putBuffers).toHaveLength(1);
      const savedMeta = createdAssetData?.['metadata'] as Record<string, unknown>;
      expect(savedMeta['wordCount']).toBe(11);

      // Invalid JSON in LORE_JSON asset must throw VALIDATION_FAILED
      await expect(
        service.reviseTextAsset('ast_json', { contentText: '{broken json' }),
      ).rejects.toThrow(/Invalid JSON/);
    });
  });

  describe('4.2 Inpainting mask compositing (compositeInpaint)', () => {
    it('replaces white-masked region with generated pixels while preserving black-masked original pixels', async () => {
      const size = 64;
      const sourceBlue = await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: { r: 20, g: 40, b: 220, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const generatedGold = await sharp({
        create: {
          width: size,
          height: size,
          channels: 4,
          background: { r: 245, g: 196, b: 81, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      // Left half black (0 = keep sourceBlue), right half white (255 = replace with generatedGold)
      const maskRaw = Buffer.alloc(size * size * 4);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * 4;
          const v = x >= size / 2 ? 255 : 0;
          maskRaw[idx] = v;
          maskRaw[idx + 1] = v;
          maskRaw[idx + 2] = v;
          maskRaw[idx + 3] = 255;
        }
      }
      const maskBuf = await sharp(maskRaw, {
        raw: { width: size, height: size, channels: 4 },
      })
        .png()
        .toBuffer();

      const composited = await imageProc.compositeInpaint(
        sourceBlue,
        generatedGold,
        maskBuf,
      );
      const { data } = await sharp(composited)
        .raw()
        .toBuffer({ resolveWithObject: true });

      // Far left pixel (8, 32) -> preserved sourceBlue
      const leftIdx = (32 * size + 8) * 4;
      expect(data[leftIdx]).toBe(20);
      expect(data[leftIdx + 2]).toBe(220);

      // Far right pixel (56, 32) -> replaced with generatedGold
      const rightIdx = (32 * size + 56) * 4;
      expect(data[rightIdx]).toBe(245);
      expect(data[rightIdx + 1]).toBe(196);
    });
  });

  describe('4.3 Audio trim & equal-power loop crossfade (editWavAudio)', () => {
    it('eliminates a harsh loop boundary amplitude jump using equal-power crossfade', () => {
      const sampleRate = 22050;
      const samples = new Float32Array(sampleRate * 2); // 2.0 seconds
      for (let i = 0; i < samples.length; i++) {
        const t = i / sampleRate;
        // First half quiet (0.12 amplitude), second half loud (0.85 amplitude) -> huge loop seam jump
        const amp = i < sampleRate ? 0.12 : 0.85;
        samples[i] = Math.sin(2 * Math.PI * 220 * t) * amp;
      }
      const rawWav = encodeWavPcm16([samples], sampleRate);

      const unedited = editWavAudio(rawWav, {});
      expect(unedited.loopSeamDb).toBeGreaterThan(12);

      const crossfaded = editWavAudio(rawWav, { crossfadeMs: 250 });
      expect(crossfaded.loopSeamDb).toBeLessThan(2.5);
      expect(crossfaded.durationMs).toBeLessThan(unedited.durationMs);
    });
  });

  describe('4.4 PBR Map Derivation (derivePbrMaps)', () => {
    it('derives tangent-space Normal map and 3-channel ORM map from an albedo texture', async () => {
      const size = 64;
      const rgb = Buffer.alloc(size * size * 3);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const idx = (y * size + x) * 3;
          // Raised bright square in center (16..48)
          const bright = x >= 16 && x < 48 && y >= 16 && y < 48 ? 220 : 40;
          rgb[idx] = bright;
          rgb[idx + 1] = bright;
          rgb[idx + 2] = bright;
        }
      }
      const albedoBuf = await sharp(rgb, {
        raw: { width: size, height: size, channels: 3 },
      })
        .png()
        .toBuffer();

      const maps = await imageProc.derivePbrMaps(albedoBuf, 3.0);

      const normalRaw = await sharp(maps.normalPng)
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect(normalRaw.info.width).toBe(64);
      expect(normalRaw.info.channels).toBe(3);

      // Flat interior pixel (32, 32) has neutral tangent normal (~128, ~128, 255)
      const flatIdx = (32 * size + 32) * 3;
      expect(normalRaw.data[flatIdx]).toBeCloseTo(128, -1);
      expect(normalRaw.data[flatIdx + 1]).toBeCloseTo(128, -1);
      expect(normalRaw.data[flatIdx + 2]).toBe(255);

      // Step edge pixel (16, 32) has non-neutral X normal component
      const edgeIdx = (32 * size + 16) * 3;
      expect(Math.abs(normalRaw.data[edgeIdx]! - 128)).toBeGreaterThan(30);

      const ormMeta = await sharp(maps.ormPng).metadata();
      expect(ormMeta.width).toBe(64);
      expect(ormMeta.height).toBe(64);
      expect(ormMeta.channels).toBe(3);
    });
  });
});
