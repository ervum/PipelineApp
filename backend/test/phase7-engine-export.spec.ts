import { ApprovalStatus, AssetFileRole, Modality } from '@forge/shared';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  EngineExportService,
  parseZipEntries,
} from '../src/projects-vault/engine-export.service';
import { StorageService } from '../src/storage/storage.service';

describe('Phase 7 — Game Engine Export Bundles & Live Watched-Folder Sync', () => {
  const sampleAssets = [
    {
      id: 'asset_icon_01',
      projectId: 'proj_1',
      title: 'Ancient Relic Icon',
      modality: Modality.ICONS_2D,
      approval: ApprovalStatus.FINAL,
      metadata: { width: 512, height: 512 },
      createdAt: new Date('2026-10-30T10:00:00Z'),
      files: [
        {
          id: 'file_icon_primary',
          role: AssetFileRole.PRIMARY,
          storageKey: 'projects/proj_1/assets/icon.png',
          mimeType: 'image/png',
        },
      ],
    },
    {
      id: 'asset_tex_02',
      projectId: 'proj_1',
      title: 'Obsidian Cobblestone',
      modality: Modality.IMAGES,
      approval: ApprovalStatus.APPROVED,
      metadata: { seamless: true },
      createdAt: new Date('2026-10-30T10:05:00Z'),
      files: [
        {
          id: 'file_tex_primary',
          role: AssetFileRole.PRIMARY,
          storageKey: 'projects/proj_1/assets/tex.png',
          mimeType: 'image/png',
        },
        {
          id: 'file_tex_normal',
          role: AssetFileRole.TEXTURE_NORMAL,
          storageKey: 'projects/proj_1/assets/tex_normal.png',
          mimeType: 'image/png',
        },
      ],
    },
    {
      id: 'asset_model_03',
      projectId: 'proj_1',
      title: 'Stone Altar',
      modality: Modality.ASSETS_3D,
      approval: ApprovalStatus.FINAL,
      metadata: { triangleCount: 1200 },
      createdAt: new Date('2026-10-30T10:10:00Z'),
      files: [
        {
          id: 'file_model_primary',
          role: AssetFileRole.PRIMARY,
          storageKey: 'projects/proj_1/assets/altar.glb',
          mimeType: 'model/gltf-binary',
        },
        {
          id: 'file_model_lod1',
          role: AssetFileRole.LOD1,
          storageKey: 'projects/proj_1/assets/altar_lod1.glb',
          mimeType: 'model/gltf-binary',
        },
      ],
    },
    {
      id: 'asset_sfx_04',
      projectId: 'proj_1',
      title: 'Relic Hum',
      modality: Modality.SFX,
      approval: ApprovalStatus.FINAL,
      metadata: { loopable: true },
      createdAt: new Date('2026-10-30T10:15:00Z'),
      files: [
        {
          id: 'file_sfx_primary',
          role: AssetFileRole.PRIMARY,
          storageKey: 'projects/proj_1/assets/hum.wav',
          mimeType: 'audio/wav',
        },
      ],
    },
  ];

  function createService(): {
    service: EngineExportService;
    storedFiles: Map<string, Buffer>;
  } {
    const storedFiles = new Map<string, Buffer>([
      ['projects/proj_1/assets/icon.png', Buffer.from('PNG_ICON_BYTES')],
      ['projects/proj_1/assets/tex.png', Buffer.from('PNG_TEX_BYTES')],
      ['projects/proj_1/assets/tex_normal.png', Buffer.from('PNG_NORMAL_BYTES')],
      ['projects/proj_1/assets/altar.glb', Buffer.from('GLB_PRIMARY_BYTES')],
      ['projects/proj_1/assets/altar_lod1.glb', Buffer.from('GLB_LOD1_BYTES')],
      ['projects/proj_1/assets/hum.wav', Buffer.from('RIFF_WAV_BYTES')],
    ]);

    const prismaMock = {
      project: {
        findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
          where.id === 'proj_1'
            ? {
                id: 'proj_1',
                name: 'Chrono Citadel',
                slug: 'chrono-citadel',
                genre: 'Action RPG',
              }
            : null,
        ),
      },
      generatedAsset: {
        findMany: jest.fn(
          async ({
            where,
          }: {
            where: { projectId: string; approval?: { in?: ApprovalStatus[] } };
          }) => {
            const allowed = where.approval?.in;
            return sampleAssets.filter(
              (a) =>
                a.projectId === where.projectId &&
                (!allowed || allowed.includes(a.approval)),
            );
          },
        ),
      },
    } as unknown as PrismaService;

    const storageMock = {
      exists: jest.fn(async (key: string) => storedFiles.has(key)),
      getBuffer: jest.fn(async (key: string) => {
        const buf = storedFiles.get(key);
        if (!buf) throw new Error(`Missing key ${key}`);
        return buf;
      }),
      putBuffer: jest.fn(async (key: string, buf: Buffer) => {
        storedFiles.set(key, buf);
      }),
    } as unknown as StorageService;

    return {
      service: new EngineExportService(prismaMock, storageMock),
      storedFiles,
    };
  }

  describe('7.1 Game Engine Export Bundle Generator', () => {
    it('exports a valid GODOT zip bundle with .import sidecars and forge_manifest.tres', async () => {
      const { service } = createService();

      const res = await service.exportProjectBundle('proj_1', {
        targetEngine: 'GODOT',
        approvalFilter: 'APPROVED_AND_FINAL',
        includeLodFiles: true,
        includePbrMaps: true,
      });

      expect(res.assetCount).toBe(4);
      expect(res.fileCount).toBe(6); // icon + tex + normal + glb + lod1 + sfx
      expect(res.zipBuffer.readUInt32LE(0)).toBe(0x04034b50); // PK\x03\x04

      const entries = parseZipEntries(res.zipBuffer);
      const entryMap = new Map(entries.map((e) => [e.path, e.data.toString('utf8')]));

      // Verify Godot .import sidecars exist for texture, normal map, 3D scene, and WAV audio
      const normalImportKey = Array.from(entryMap.keys()).find((k) =>
        k.endsWith('_normal.png.import'),
      );
      expect(normalImportKey).toBeDefined();
      expect(entryMap.get(normalImportKey!)).toContain('importer="texture"');
      expect(entryMap.get(normalImportKey!)).toContain('compress/normal_map=1');

      const glbImportKey = Array.from(entryMap.keys()).find(
        (k) => k.startsWith('models/') && k.endsWith('.glb.import'),
      );
      expect(glbImportKey).toBeDefined();
      expect(entryMap.get(glbImportKey!)).toContain('importer="scene"');

      const wavImportKey = Array.from(entryMap.keys()).find(
        (k) => k.startsWith('audio/sfx/') && k.endsWith('.wav.import'),
      );
      expect(wavImportKey).toBeDefined();
      expect(entryMap.get(wavImportKey!)).toContain('importer="wav"');
      expect(entryMap.get(wavImportKey!)).toContain('edit/loop_mode=1');

      expect(entryMap.has('forge_manifest.tres')).toBe(true);
      expect(entryMap.get('forge_manifest.tres')).toContain(
        '[gd_resource type="Resource" format=3]',
      );
      expect(entryMap.has('manifest.json')).toBe(true);
    });

    it('exports a valid UNITY zip bundle with deterministic 32-hex GUID .meta sidecars', async () => {
      const { service } = createService();

      const res = await service.exportProjectBundle('proj_1', {
        targetEngine: 'UNITY',
        approvalFilter: 'APPROVED_AND_FINAL',
        includeLodFiles: true,
        includePbrMaps: true,
      });

      const entries = parseZipEntries(res.zipBuffer);
      const entryMap = new Map(entries.map((e) => [e.path, e.data.toString('utf8')]));

      const iconMetaKey = Array.from(entryMap.keys()).find(
        (k) => k.startsWith('icons/') && k.endsWith('.png.meta'),
      );
      expect(iconMetaKey).toBeDefined();
      const iconMeta = entryMap.get(iconMetaKey!)!;
      expect(iconMeta).toMatch(/guid: [0-9a-f]{32}/);
      expect(iconMeta).toContain('TextureImporter:');
      expect(iconMeta).toContain('textureType: 8'); // Sprite/UI icon

      const normalMetaKey = Array.from(entryMap.keys()).find((k) =>
        k.endsWith('_normal.png.meta'),
      );
      expect(entryMap.get(normalMetaKey!)).toContain('textureType: 1'); // Normal map
    });

    it('exports a valid ROBLOX zip bundle with Rojo default.project.json and AssetManifest.luau', async () => {
      const { service } = createService();

      const res = await service.exportProjectBundle('proj_1', {
        targetEngine: 'ROBLOX',
        approvalFilter: 'FINAL_ONLY',
        includeLodFiles: false,
        includePbrMaps: false,
      });

      // Only FINAL assets (3 assets, PRIMARY files only)
      expect(res.assetCount).toBe(3);
      expect(res.fileCount).toBe(3);

      const entries = parseZipEntries(res.zipBuffer);
      const entryMap = new Map(entries.map((e) => [e.path, e.data.toString('utf8')]));

      expect(entryMap.has('default.project.json')).toBe(true);
      const rojo = JSON.parse(entryMap.get('default.project.json')!);
      expect(rojo.tree.ReplicatedStorage.ForgeAssets.$path).toBe('src/Shared');

      expect(entryMap.has('src/Shared/AssetManifest.luau')).toBe(true);
      const luau = entryMap.get('src/Shared/AssetManifest.luau')!;
      expect(luau).toContain('export type ForgeAssetEntry');
      expect(luau).toContain('Ancient Relic Icon');
    });
  });

  describe('7.2 Live Watched-Directory Sync', () => {
    it('writes exported files and sidecars directly to a configured sync directory on FINAL', async () => {
      const { service } = createService();
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'forge-sync-test-'));

      try {
        await service.configureSyncDirectory('proj_1', {
          targetDir: tmpDir,
          targetEngine: 'GODOT',
          autoSyncOnFinal: true,
        });

        await service.syncOnAssetFinalized('proj_1');

        const manifestPath = path.join(tmpDir, 'manifest.json');
        const manifestRaw = await fs.readFile(manifestPath, 'utf8');
        const manifest = JSON.parse(manifestRaw);

        expect(manifest.targetEngine).toBe('GODOT');
        expect(manifest.assetCount).toBe(3); // FINAL_ONLY assets

        const tresRaw = await fs.readFile(path.join(tmpDir, 'forge_manifest.tres'), 'utf8');
        expect(tresRaw).toContain('Chrono Citadel');
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
