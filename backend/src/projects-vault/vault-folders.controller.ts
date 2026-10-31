import {
  CreateFolderDto,
  CreateFolderSchema,
  UpdateFolderDto,
  UpdateFolderSchema,
  VaultFolderModel,
} from '@forge/shared';
import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { VaultFoldersService } from './vault-folders.service';

@Controller()
export class VaultFoldersController {
  constructor(private readonly foldersService: VaultFoldersService) {}

  @Get('projects/:id/vault/tree')
  async tree(@Param('id') projectId: string): Promise<VaultFolderModel> {
    return this.foldersService.tree(projectId);
  }

  @Post('projects/:id/vault/folders')
  async create(
    @Param('id') projectId: string,
    @ZodBody(CreateFolderSchema) dto: CreateFolderDto,
  ): Promise<VaultFolderModel> {
    return this.foldersService.create(projectId, dto);
  }

  @Patch('vault/folders/:folderId')
  async update(
    @Param('folderId') folderId: string,
    @ZodBody(UpdateFolderSchema) dto: UpdateFolderDto,
  ): Promise<VaultFolderModel> {
    return this.foldersService.update(folderId, dto);
  }

  @Delete('vault/folders/:folderId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('folderId') folderId: string,
    @Query('recursive') recursive?: string,
  ): Promise<void> {
    await this.foldersService.delete(folderId, recursive === 'true' || recursive === '1');
  }
}
