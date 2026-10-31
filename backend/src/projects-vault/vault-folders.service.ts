import {
  CreateFolderDto,
  ErrorCode,
  UpdateFolderDto,
  VaultFolderModel,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error';
import { toVaultFolderModel, VaultFolderWithCount } from '../common/mappers/vault.mapper';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

@Injectable()
export class VaultFoldersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  async tree(projectId: string): Promise<VaultFolderModel> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Project not found: ${projectId}`);
    }

    const rows = await this.prisma.vaultFolder.findMany({
      where: { projectId },
      include: { _count: { select: { files: true } } },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    if (rows.length === 0) {
      const rootCreated = await this.prisma.vaultFolder.create({
        data: {
          projectId,
          parentId: null,
          name: 'Root',
          path: '/',
          sortOrder: 0,
        },
        include: { _count: { select: { files: true } } },
      });
      return toVaultFolderModel(rootCreated, []);
    }

    const byParent = new Map<string | null, VaultFolderWithCount[]>();
    let rootRow: VaultFolderWithCount | undefined;

    for (const row of rows) {
      if (row.parentId === null || row.path === '/') {
        rootRow = row;
      } else {
        const list = byParent.get(row.parentId) ?? [];
        list.push(row);
        byParent.set(row.parentId, list);
      }
    }

    if (!rootRow) {
      rootRow = rows[0]!;
    }

    const buildNode = (folder: VaultFolderWithCount): VaultFolderModel => {
      const childrenRows = byParent.get(folder.id) ?? [];
      childrenRows.sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });
      const children = childrenRows.map(buildNode);
      return toVaultFolderModel(folder, children);
    };

    return buildNode(rootRow);
  }

  async create(projectId: string, dto: CreateFolderDto): Promise<VaultFolderModel> {
    const parent = await this.prisma.vaultFolder.findUnique({ where: { id: dto.parentId } });
    if (!parent || parent.projectId !== projectId) {
      throw new DomainError(
        ErrorCode.NOT_FOUND,
        404,
        `Parent folder ${dto.parentId} not found in project ${projectId}`,
      );
    }

    const newPath = parent.path === '/' ? `/${dto.name}` : `${parent.path}/${dto.name}`;
    const existing = await this.prisma.vaultFolder.findUnique({
      where: { projectId_path: { projectId, path: newPath } },
    });
    if (existing) {
      throw new DomainError(
        ErrorCode.CONFLICT,
        409,
        `Folder path "${newPath}" already exists in this project`,
      );
    }

    const created = await this.prisma.vaultFolder.create({
      data: {
        projectId,
        parentId: parent.id,
        name: dto.name,
        path: newPath,
        sortOrder: 0,
      },
      include: { _count: { select: { files: true } } },
    });

    return toVaultFolderModel(created, []);
  }

  async update(folderId: string, dto: UpdateFolderDto): Promise<VaultFolderModel> {
    const folder = await this.prisma.vaultFolder.findUnique({
      where: { id: folderId },
      include: { _count: { select: { files: true } } },
    });
    if (!folder) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Folder not found: ${folderId}`);
    }
    if (folder.path === '/' || folder.parentId === null) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Cannot rename or move the root vault folder',
      );
    }

    const targetParentId = dto.parentId ?? folder.parentId;
    const targetName = dto.name ?? folder.name;
    const targetSortOrder = dto.sortOrder ?? folder.sortOrder;

    const targetParent = await this.prisma.vaultFolder.findUnique({
      where: { id: targetParentId },
    });
    if (!targetParent || targetParent.projectId !== folder.projectId) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, 'Target parent folder not found');
    }

    if (
      targetParent.id === folder.id ||
      targetParent.path.startsWith(`${folder.path}/`)
    ) {
      throw new DomainError(
        ErrorCode.CONFLICT,
        409,
        'Cannot move a folder into itself or one of its own descendants',
      );
    }

    const oldPath = folder.path;
    const newPath =
      targetParent.path === '/' ? `/${targetName}` : `${targetParent.path}/${targetName}`;

    const updated = await this.prisma.$transaction(async (tx) => {
      if (newPath !== oldPath) {
        const collision = await tx.vaultFolder.findUnique({
          where: { projectId_path: { projectId: folder.projectId, path: newPath } },
        });
        if (collision && collision.id !== folder.id) {
          throw new DomainError(
            ErrorCode.CONFLICT,
            409,
            `Folder path "${newPath}" already exists`,
          );
        }

        const descendants = await tx.vaultFolder.findMany({
          where: {
            projectId: folder.projectId,
            path: { startsWith: `${oldPath}/` },
          },
        });

        for (const desc of descendants) {
          const rewrittenPath = `${newPath}${desc.path.slice(oldPath.length)}`;
          await tx.vaultFolder.update({
            where: { id: desc.id },
            data: { path: rewrittenPath },
          });
        }
      }

      return tx.vaultFolder.update({
        where: { id: folder.id },
        data: {
          parentId: targetParent.id,
          name: targetName,
          path: newPath,
          sortOrder: targetSortOrder,
        },
        include: { _count: { select: { files: true } } },
      });
    });

    return toVaultFolderModel(updated, []);
  }

  async delete(folderId: string, recursive = false): Promise<void> {
    const folder = await this.prisma.vaultFolder.findUnique({ where: { id: folderId } });
    if (!folder) {
      throw new DomainError(ErrorCode.NOT_FOUND, 404, `Folder not found: ${folderId}`);
    }
    if (folder.path === '/' || folder.parentId === null) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        'Cannot delete the root vault folder',
      );
    }

    const subtreeFolders = await this.prisma.vaultFolder.findMany({
      where: {
        projectId: folder.projectId,
        OR: [{ id: folder.id }, { path: { startsWith: `${folder.path}/` } }],
      },
      select: { id: true },
    });
    const subtreeFolderIds = subtreeFolders.map((f) => f.id);

    const containedFiles = await this.prisma.vaultFile.findMany({
      where: { folderId: { in: subtreeFolderIds } },
      select: { id: true, storageKey: true, thumbnailKey: true },
    });

    if (!recursive && (subtreeFolders.length > 1 || containedFiles.length > 0)) {
      throw new DomainError(
        ErrorCode.CONFLICT,
        409,
        'Folder is not empty; pass ?recursive=true to delete folder and all contents',
      );
    }

    await this.prisma.vaultFolder.delete({ where: { id: folder.id } });

    for (const file of containedFiles) {
      if (file.storageKey) {
        await this.storage.delete(file.storageKey).catch(() => undefined);
      }
      if (file.thumbnailKey) {
        await this.storage.delete(file.thumbnailKey).catch(() => undefined);
      }
    }
  }
}
