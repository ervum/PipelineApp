import {
  ApprovalStatus,
  AssetFileRole,
  ConfigureSyncDirectoryDto,
  ErrorCode,
  ExportEngine,
  ExportProjectBundleDto,
  Modality,
} from '@forge/shared';
import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import { DomainError } from '../common/errors/domain.error';
import { sha256Hex } from '../common/utils/sha256';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

export interface ZipEntry {
  path: string;
  data: Buffer;
}

export interface ExportedFileSummary {
  assetId: string;
  assetTitle: string;
  category: string;
  role: string;
  relativePath: string;
  sidecarPath: string | null;
  sizeBytes: number;
}

export interface ExportBundleResult {
  projectId: string;
  projectSlug: string;
  targetEngine: ExportEngine;
  assetCount: number;
  fileCount: number;
  files: ExportedFileSummary[];
  syncedToDir: string | null;
  zipBuffer: Buffer;
}

export interface SyncConfigState {
  projectId: string;
  targetDir: string | null;
  targetEngine: ExportEngine;
  autoSyncOnFinal: boolean;
  updatedAt: string;
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32(buf: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const byte = buf[i] ?? 0;
    const tableVal = CRC32_TABLE[(crc ^ byte) & 0xff] ?? 0;
    crc = tableVal ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Pure-TypeScript PKZIP archive builder (STORE method 0, UTF-8 filenames).
 */
export function buildZipArchive(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const normalizedPath = entry.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBuf = Buffer.from(normalizedPath, 'utf8');
    const dataBuf = entry.data;
    const crc = computeCrc32(dataBuf);
    const size = dataBuf.length;

    // Local file header (30 bytes + filename)
    const localHeader = Buffer.alloc(30 + nameBuf.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0x0800, 6); // General purpose bit flag (UTF-8)
    localHeader.writeUInt16LE(0, 8); // Compression method (0 = STORE)
    localHeader.writeUInt16LE(0, 10); // Last mod file time
    localHeader.writeUInt16LE(0x5421, 12); // Last mod file date
    localHeader.writeUInt32LE(crc, 14); // CRC-32
    localHeader.writeUInt32LE(size, 18); // Compressed size
    localHeader.writeUInt32LE(size, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuf.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    nameBuf.copy(localHeader, 30);

    localChunks.push(localHeader, dataBuf);

    // Central directory file header (46 bytes + filename)
    const centralHeader = Buffer.alloc(46 + nameBuf.length);
    centralHeader.writeUInt32LE(0x02014b50, 0); // Central file header signature
    centralHeader.writeUInt16LE(20, 4); // Version made by
    centralHeader.writeUInt16LE(20, 6); // Version needed to extract
    centralHeader.writeUInt16LE(0x0800, 8); // General purpose bit flag (UTF-8)
    centralHeader.writeUInt16LE(0, 10); // Compression method (0 = STORE)
    centralHeader.writeUInt16LE(0, 12); // Last mod file time
    centralHeader.writeUInt16LE(0x5421, 14); // Last mod file date
    centralHeader.writeUInt32LE(crc, 16); // CRC-32
    centralHeader.writeUInt32LE(size, 20); // Compressed size
    centralHeader.writeUInt32LE(size, 24); // Uncompressed size
    centralHeader.writeUInt16LE(nameBuf.length, 28); // File name length
    centralHeader.writeUInt16LE(0, 30); // Extra field length
    centralHeader.writeUInt16LE(0, 32); // File comment length
    centralHeader.writeUInt16LE(0, 34); // Disk number start
    centralHeader.writeUInt16LE(0, 36); // Internal file attributes
    centralHeader.writeUInt32LE(0, 38); // External file attributes
    centralHeader.writeUInt32LE(localOffset, 42); // Relative offset of local header
    nameBuf.copy(centralHeader, 46);

    centralChunks.push(centralHeader);
    localOffset += localHeader.length + size;
  }

  const centralDirBuffer = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // End of central dir signature
  eocd.writeUInt16LE(0, 4); // Number of this disk
  eocd.writeUInt16LE(0, 6); // Disk where central directory starts
  eocd.writeUInt16LE(entries.length, 8); // Total entries on this disk
  eocd.writeUInt16LE(entries.length, 10); // Total entries
  eocd.writeUInt32LE(centralDirBuffer.length, 12); // Size of central directory
  eocd.writeUInt32LE(localOffset, 16); // Offset of start of central directory
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localChunks, centralDirBuffer, eocd]);
}

/**
 * Parses a STORE-compressed PKZIP buffer back into entries (useful for verification/tests).
 */
export function parseZipEntries(zipBuffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  let offset = 0;
  while (offset + 30 <= zipBuffer.length) {
    const sig = zipBuffer.readUInt32LE(offset);
    if (sig !== 0x04034b50) break;
    const size = zipBuffer.readUInt32LE(offset + 18);
    const nameLen = zipBuffer.readUInt16LE(offset + 26);
    const extraLen = zipBuffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLen + extraLen;
    const entryPath = zipBuffer.subarray(nameStart, nameStart + nameLen).toString('utf8');
    const data = Buffer.from(zipBuffer.subarray(dataStart, dataStart + size));
    entries.push({ path: entryPath, data });
    offset = dataStart + size;
  }
  return entries;
}

function toSafeFileSlug(title: string, fallbackId: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
  const shortId = fallbackId.replace(/[^a-zA-Z0-9]/g, '').slice(-6).toLowerCase();
  return base.length >= 2 ? `${base}_${shortId}` : `asset_${shortId}`;
}

@Injectable()
export class EngineExportService {
  private readonly logger = new Logger(EngineExportService.name);
  private readonly syncConfigs = new Map<string, SyncConfigState>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async configureSyncDirectory(
    projectId: string,
    dto: ConfigureSyncDirectoryDto,
  ): Promise<SyncConfigState> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Project not found: ${projectId}`);
    }

    const state: SyncConfigState = {
      projectId,
      targetDir: dto.targetDir && dto.targetDir.trim().length > 0 ? dto.targetDir.trim() : null,
      targetEngine: dto.targetEngine ?? 'GODOT',
      autoSyncOnFinal: dto.autoSyncOnFinal ?? true,
      updatedAt: new Date().toISOString(),
    };
    this.syncConfigs.set(projectId, state);
    await this.storage.putBuffer(
      `projects/${projectId}/sync-config.json`,
      Buffer.from(JSON.stringify(state, null, 2), 'utf8'),
      'application/json',
    );
    return state;
  }

  async getSyncConfig(projectId: string): Promise<SyncConfigState | null> {
    const inMem = this.syncConfigs.get(projectId);
    if (inMem) return inMem;
    const key = `projects/${projectId}/sync-config.json`;
    if (await this.storage.exists(key)) {
      try {
        const buf = await this.storage.getBuffer(key);
        const parsed = JSON.parse(buf.toString('utf8')) as SyncConfigState;
        this.syncConfigs.set(projectId, parsed);
        return parsed;
      } catch {
        return null;
      }
    }
    return null;
  }

  /**
   * Automatically invoked when an asset's approvalStatus changes to FINAL.
   */
  async syncOnAssetFinalized(projectId: string): Promise<void> {
    const cfg = await this.getSyncConfig(projectId);
    if (!cfg || !cfg.targetDir || !cfg.autoSyncOnFinal) {
      return;
    }
    try {
      await this.exportProjectBundle(projectId, {
        targetEngine: cfg.targetEngine,
        approvalFilter: 'FINAL_ONLY',
        includeLodFiles: true,
        includePbrMaps: true,
        syncToDir: cfg.targetDir,
      });
    } catch (err) {
      this.logger.warn(
        `Auto-sync on FINAL failed for project ${projectId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  async exportProjectBundle(
    projectId: string,
    dto: ExportProjectBundleDto,
  ): Promise<ExportBundleResult> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Project not found: ${projectId}`);
    }

    const approvalStatuses: ApprovalStatus[] =
      dto.approvalFilter === 'FINAL_ONLY'
        ? [ApprovalStatus.FINAL]
        : dto.approvalFilter === 'APPROVED_AND_FINAL'
          ? [ApprovalStatus.APPROVED, ApprovalStatus.FINAL]
          : [
              ApprovalStatus.DRAFT,
              ApprovalStatus.APPROVED,
              ApprovalStatus.FINAL,
              ApprovalStatus.REJECTED,
            ];

    let assets = await this.prisma.generatedAsset.findMany({
      where: {
        projectId,
        approval: { in: approvalStatuses },
      },
      include: { files: true },
      orderBy: { createdAt: 'asc' },
    });

    // If no assets match APPROVED_AND_FINAL, fall back to all non-rejected assets so exports on fresh projects still work
    if (assets.length === 0 && dto.approvalFilter === 'APPROVED_AND_FINAL') {
      assets = await this.prisma.generatedAsset.findMany({
        where: {
          projectId,
          approval: { not: ApprovalStatus.REJECTED },
        },
        include: { files: true },
        orderBy: { createdAt: 'asc' },
      });
    }

    const zipEntries: ZipEntry[] = [];
    const fileSummaries: ExportedFileSummary[] = [];

    for (const asset of assets) {
      const slug = toSafeFileSlug(asset.title, asset.id);
      const meta =
        asset.metadata && typeof asset.metadata === 'object' && !Array.isArray(asset.metadata)
          ? (asset.metadata as Record<string, unknown>)
          : {};

      const allowedRoles = new Set<string>([AssetFileRole.PRIMARY]);
      if (dto.includeLodFiles) {
        allowedRoles.add(AssetFileRole.LOD1);
        allowedRoles.add(AssetFileRole.LOD2);
      }
      if (dto.includePbrMaps) {
        allowedRoles.add(AssetFileRole.TEXTURE_NORMAL);
        allowedRoles.add(AssetFileRole.TEXTURE_ORM);
      }

      for (const file of asset.files) {
        if (!allowedRoles.has(file.role)) continue;
        if (!(await this.storage.exists(file.storageKey))) continue;

        const fileBuf = await this.storage.getBuffer(file.storageKey);
        const relPath = this.resolveRelativePath(
          asset.modality as Modality,
          slug,
          file.role as AssetFileRole,
          file.mimeType,
          meta,
        );

        zipEntries.push({ path: relPath, data: fileBuf });

        let sidecarPath: string | null = null;
        if (dto.targetEngine === 'GODOT') {
          const godotImport = this.buildGodotImportSidecar(
            asset.modality as Modality,
            file.role as AssetFileRole,
            relPath,
            file.id,
            meta,
          );
          if (godotImport) {
            sidecarPath = `${relPath}.import`;
            zipEntries.push({
              path: sidecarPath,
              data: Buffer.from(godotImport, 'utf8'),
            });
          }
        } else if (dto.targetEngine === 'UNITY') {
          sidecarPath = `${relPath}.meta`;
          const unityMeta = this.buildUnityMetaSidecar(
            asset.modality as Modality,
            file.role as AssetFileRole,
            file.id,
            meta,
          );
          zipEntries.push({
            path: sidecarPath,
            data: Buffer.from(unityMeta, 'utf8'),
          });
        }

        fileSummaries.push({
          assetId: asset.id,
          assetTitle: asset.title,
          category: asset.modality,
          role: file.role,
          relativePath: relPath,
          sidecarPath,
          sizeBytes: fileBuf.length,
        });
      }
    }

    // Engine-level project manifests
    if (dto.targetEngine === 'GODOT') {
      const tres = this.buildGodotManifestTres(project.name, project.slug, fileSummaries);
      zipEntries.push({
        path: 'forge_manifest.tres',
        data: Buffer.from(tres, 'utf8'),
      });
    } else if (dto.targetEngine === 'ROBLOX') {
      const rojoJson = this.buildRobloxRojoProject(project.name, project.slug);
      const luauManifest = this.buildRobloxAssetManifestLuau(fileSummaries);
      zipEntries.push({
        path: 'default.project.json',
        data: Buffer.from(rojoJson, 'utf8'),
      });
      zipEntries.push({
        path: 'src/Shared/AssetManifest.luau',
        data: Buffer.from(luauManifest, 'utf8'),
      });
    }

    const manifestPayload = {
      schemaVersion: '1.0',
      exportedAt: new Date().toISOString(),
      targetEngine: dto.targetEngine,
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        genre: project.genre,
      },
      assetCount: assets.length,
      files: fileSummaries,
    };
    zipEntries.push({
      path: 'manifest.json',
      data: Buffer.from(JSON.stringify(manifestPayload, null, 2), 'utf8'),
    });

    // Live watched-folder / directory sync if requested
    let syncedToDir: string | null = null;
    if (dto.syncToDir && dto.syncToDir.trim().length > 0) {
      const resolvedRoot = path.resolve(dto.syncToDir.trim());
      await fs.mkdir(resolvedRoot, { recursive: true });
      for (const entry of zipEntries) {
        const destPath = path.resolve(resolvedRoot, entry.path);
        // Prevent path traversal outside resolvedRoot
        if (!destPath.startsWith(resolvedRoot)) {
          continue;
        }
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.writeFile(destPath, entry.data);
      }
      syncedToDir = resolvedRoot;
    }

    const zipBuffer = buildZipArchive(zipEntries);

    return {
      projectId: project.id,
      projectSlug: project.slug,
      targetEngine: dto.targetEngine,
      assetCount: assets.length,
      fileCount: fileSummaries.length,
      files: fileSummaries,
      syncedToDir,
      zipBuffer,
    };
  }

  private resolveRelativePath(
    category: Modality,
    slug: string,
    role: AssetFileRole,
    mimeType: string,
    meta: Record<string, unknown>,
  ): string {
    const ext = this.resolveExtension(category, mimeType, meta);
    const roleSuffix =
      role === AssetFileRole.LOD1
        ? '_lod1'
        : role === AssetFileRole.LOD2
          ? '_lod2'
          : role === AssetFileRole.TEXTURE_NORMAL
            ? '_normal'
            : role === AssetFileRole.TEXTURE_ORM
              ? '_orm'
              : '';

    switch (category) {
      case Modality.ICONS_2D:
        return `icons/${slug}${roleSuffix}.${ext}`;
      case Modality.IMAGES:
        return `textures/${slug}${roleSuffix}.${ext}`;
      case Modality.ASSETS_3D:
        return `models/${slug}${roleSuffix}.${ext}`;
      case Modality.MUSIC:
        return `audio/music/${slug}${roleSuffix}.${ext}`;
      case Modality.VOICES:
        return `audio/voices/${slug}${roleSuffix}.${ext}`;
      case Modality.SFX:
        return `audio/sfx/${slug}${roleSuffix}.${ext}`;
      case Modality.LORE:
        return `lore/${slug}${roleSuffix}.md`;
      case Modality.OTHER:
        if (mimeType.includes('image')) {
          return `textures/${slug}${roleSuffix}.${ext}`;
        }
        return `shaders/${slug}${roleSuffix}.${ext}`;
      default:
        return `assets/${slug}${roleSuffix}.${ext}`;
    }
  }

  private resolveExtension(
    category: Modality,
    mimeType: string,
    meta: Record<string, unknown>,
  ): string {
    if (category === Modality.OTHER && !mimeType.includes('image')) {
      const lang = typeof meta.language === 'string' ? meta.language.toUpperCase() : '';
      if (lang.includes('GDSHADER') || lang.includes('GODOT')) return 'gdshader';
      if (lang.includes('HLSL')) return 'hlsl';
      if (lang.includes('GLSL')) return 'glsl';
      if (lang.includes('LUA')) return 'luau';
      if (lang.includes('CSHARP') || lang.includes('C#')) return 'cs';
      if (lang.includes('JSON')) return 'json';
      return 'ts';
    }
    if (category === Modality.LORE) return 'md';
    if (mimeType.includes('png')) return 'png';
    if (mimeType.includes('webp')) return 'webp';
    if (mimeType.includes('jpeg') || mimeType.includes('jpg')) return 'jpg';
    if (mimeType.includes('gltf-binary') || mimeType.includes('glb')) return 'glb';
    if (mimeType.includes('obj')) return 'obj';
    if (mimeType.includes('wav')) return 'wav';
    if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
    if (mimeType.includes('ogg')) return 'ogg';
    if (category === Modality.ASSETS_3D) return 'glb';
    if (
      category === Modality.MUSIC ||
      category === Modality.VOICES ||
      category === Modality.SFX
    ) {
      return 'wav';
    }
    return 'png';
  }

  private buildGodotImportSidecar(
    category: Modality,
    role: AssetFileRole,
    relPath: string,
    fileId: string,
    meta: Record<string, unknown>,
  ): string | null {
    const uidHash = sha256Hex(fileId).slice(0, 12);

    if (
      category === Modality.ICONS_2D ||
      category === Modality.IMAGES ||
      (category === Modality.OTHER && relPath.startsWith('textures/'))
    ) {
      const isNormal = role === AssetFileRole.TEXTURE_NORMAL ? 1 : 0;
      return [
        '[remap]',
        'importer="texture"',
        'type="CompressedTexture2D"',
        `uid="uid://${uidHash}"`,
        '',
        '[deps]',
        `source_file="res://${relPath}"`,
        '',
        '[params]',
        'compress/mode=0',
        'mipmaps/generate=true',
        `compress/normal_map=${isNormal}`,
        'roughness/mode=0',
        '',
      ].join('\n');
    }

    if (category === Modality.ASSETS_3D) {
      return [
        '[remap]',
        'importer="scene"',
        'importer_version=1',
        'type="PackedScene"',
        `uid="uid://${uidHash}"`,
        '',
        '[deps]',
        `source_file="res://${relPath}"`,
        '',
        '[params]',
        'meshes/ensure_tangents=true',
        'meshes/generate_lods=true',
        '',
      ].join('\n');
    }

    if (
      category === Modality.MUSIC ||
      category === Modality.VOICES ||
      category === Modality.SFX
    ) {
      const loopMode = category === Modality.MUSIC || meta.loopable === true ? 1 : 0;
      return [
        '[remap]',
        'importer="wav"',
        'type="AudioStreamWAV"',
        `uid="uid://${uidHash}"`,
        '',
        '[deps]',
        `source_file="res://${relPath}"`,
        '',
        '[params]',
        'force/8_bit=false',
        'force/mono=false',
        `edit/loop_mode=${loopMode}`,
        'compress/mode=0',
        '',
      ].join('\n');
    }

    return null;
  }

  private buildUnityMetaSidecar(
    category: Modality,
    role: AssetFileRole,
    fileId: string,
    meta: Record<string, unknown>,
  ): string {
    const guid = sha256Hex(fileId).slice(0, 32);

    if (
      category === Modality.ICONS_2D ||
      category === Modality.IMAGES
    ) {
      const textureType =
        role === AssetFileRole.TEXTURE_NORMAL
          ? 1
          : category === Modality.ICONS_2D
            ? 8
            : 0;
      const wrapMode = meta.seamless === true ? 0 : 1;
      return [
        'fileFormatVersion: 2',
        `guid: ${guid}`,
        'TextureImporter:',
        '  internalIDToNameTable: []',
        '  serializedVersion: 12',
        '  mipmaps:',
        '    mipMapMode: 0',
        `    enableMipMap: ${category === Modality.ICONS_2D ? 0 : 1}`,
        '    sRGBTexture: 1',
        '  textureSettings:',
        '    serializedVersion: 2',
        '    filterMode: 1',
        `    wrapU: ${wrapMode}`,
        `    wrapV: ${wrapMode}`,
        `  textureType: ${textureType}`,
        '  alphaIsTransparency: 1',
        '',
      ].join('\n');
    }

    if (category === Modality.ASSETS_3D) {
      return [
        'fileFormatVersion: 2',
        `guid: ${guid}`,
        'ModelImporter:',
        '  serializedVersion: 21300',
        '  meshes:',
        '    globalScale: 1',
        '    useFileScale: 1',
        '    importVisibility: 1',
        '    importCameras: 0',
        '    importLights: 0',
        '',
      ].join('\n');
    }

    if (
      category === Modality.MUSIC ||
      category === Modality.VOICES ||
      category === Modality.SFX
    ) {
      return [
        'fileFormatVersion: 2',
        `guid: ${guid}`,
        'AudioImporter:',
        '  serializedVersion: 6',
        '  defaultSettings:',
        '    loadType: 0',
        '    sampleRateSetting: 0',
        '    compressionFormat: 0',
        '    quality: 1',
        '  forceToMono: 0',
        '  loadInBackground: 1',
        '',
      ].join('\n');
    }

    return [
      'fileFormatVersion: 2',
      `guid: ${guid}`,
      'TextScriptImporter:',
      '  externalObjects: {}',
      '  userData: ',
      '',
    ].join('\n');
  }

  private buildGodotManifestTres(
    projectName: string,
    projectSlug: string,
    files: ExportedFileSummary[],
  ): string {
    const entries = files
      .map(
        (f) =>
          `  "${f.relativePath}": { "assetId": "${f.assetId}", "category": "${f.category}", "role": "${f.role}" }`,
      )
      .join(',\n');
    return [
      '[gd_resource type="Resource" format=3]',
      '',
      '[resource]',
      `project_name = "${projectName.replace(/"/g, '\\"')}"`,
      `project_slug = "${projectSlug}"`,
      `assets = {\n${entries}\n}`,
      '',
    ].join('\n');
  }

  private buildRobloxRojoProject(projectName: string, projectSlug: string): string {
    return JSON.stringify(
      {
        name: projectSlug || projectName,
        tree: {
          $className: 'DataModel',
          ReplicatedStorage: {
            $className: 'ReplicatedStorage',
            ForgeAssets: {
              $path: 'src/Shared',
            },
          },
        },
      },
      null,
      2,
    );
  }

  private buildRobloxAssetManifestLuau(files: ExportedFileSummary[]): string {
    const rows = files.map(
      (f) =>
        `\t{\n\t\tassetId = "${f.assetId}",\n\t\ttitle = "${f.assetTitle.replace(/"/g, '\\"')}",\n\t\tcategory = "${f.category}",\n\t\trole = "${f.role}",\n\t\tpath = "${f.relativePath}",\n\t}`,
    );
    return [
      '--!strict',
      '-- Auto-generated by ForgeStudio Control Room Engine Exporter',
      'export type ForgeAssetEntry = {',
      '\tassetId: string,',
      '\ttitle: string,',
      '\tcategory: string,',
      '\trole: string,',
      '\tpath: string,',
      '}',
      '',
      'local AssetManifest: { ForgeAssetEntry } = {',
      rows.join(',\n'),
      '}',
      '',
      'return AssetManifest',
      '',
    ].join('\n');
  }
}
