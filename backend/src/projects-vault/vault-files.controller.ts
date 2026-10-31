import {
  AnalyzeVisionDto,
  AnalyzeVisionSchema,
  ContextFileRef,
  ContextScope,
  CreateTextFileDto,
  CreateTextFileSchema,
  ErrorCode,
  Modality,
  UpdateVaultFileDto,
  UpdateVaultFileSchema,
  UploadVaultFileFieldsSchema,
  VaultFileDetailModel,
  VaultFileKind,
  VaultFileModel,
  VaultSearchQueryDto,
  VaultSearchQuerySchema,
} from '@forge/shared';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodBody, ZodQuery } from '../common/decorators/zod-body.decorator';
import { DomainError } from '../common/errors/domain.error';
import { UploadedMulterFile } from '../common/types/multer-file.interface';
import { VaultFilesService } from './vault-files.service';

@Controller()
export class VaultFilesController {
  constructor(private readonly filesService: VaultFilesService) {}

  @Get('projects/:id/vault/files')
  async list(
    @Param('id') projectId: string,
    @Query('folderId') folderId?: string,
    @Query('scope') scope?: ContextScope,
    @Query('kind') kind?: VaultFileKind,
  ): Promise<VaultFileModel[]> {
    return this.filesService.list(projectId, { folderId, scope, kind });
  }

  @Get('projects/:id/vault/search')
  async search(
    @Param('id') projectId: string,
    @ZodQuery(VaultSearchQuerySchema) query: VaultSearchQueryDto,
  ): Promise<VaultFileModel[]> {
    return this.filesService.search(projectId, query);
  }

  @Post('projects/:id/vault/files')
  async createText(
    @Param('id') projectId: string,
    @ZodBody(CreateTextFileSchema) dto: CreateTextFileDto,
  ): Promise<VaultFileDetailModel> {
    return this.filesService.createText(projectId, dto);
  }

  @Post('projects/:id/vault/files/upload')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 200 * 1024 * 1024 },
    }),
  )
  async upload(
    @Param('id') projectId: string,
    @UploadedFile() file: UploadedMulterFile | undefined,
    @Body() rawFields: Record<string, unknown>,
  ): Promise<VaultFileDetailModel> {
    const fields = UploadVaultFileFieldsSchema.parse(rawFields ?? {});
    return this.filesService.upload(projectId, file, fields);
  }

  @Get('vault/files/:fileId')
  async get(@Param('fileId') fileId: string): Promise<VaultFileDetailModel> {
    return this.filesService.get(fileId);
  }

  @Patch('vault/files/:fileId')
  async update(
    @Param('fileId') fileId: string,
    @ZodBody(UpdateVaultFileSchema) dto: UpdateVaultFileDto,
  ): Promise<VaultFileDetailModel> {
    return this.filesService.update(fileId, dto);
  }

  @Delete('vault/files/:fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('fileId') fileId: string): Promise<void> {
    await this.filesService.delete(fileId);
  }

  @Post('vault/files/:fileId/analyze')
  @HttpCode(HttpStatus.OK)
  async analyze(
    @Param('fileId') fileId: string,
    @ZodBody(AnalyzeVisionSchema) dto: AnalyzeVisionDto,
  ): Promise<VaultFileModel> {
    return this.filesService.analyze(fileId, dto);
  }

  @Get('projects/:id/vault/context-preview')
  async contextPreview(
    @Param('id') projectId: string,
    @Query('modality') modality?: string,
    @Query('pinned') pinned?: string,
    @Query('rawPrompt') rawPrompt?: string,
  ): Promise<{
    included: ContextFileRef[];
    dropped: ContextFileRef[];
    totalTokens: number;
    budget: number;
    warnings: string[];
  }> {
    if (!modality || !Object.values(Modality).includes(modality as Modality)) {
      throw new DomainError(
        ErrorCode.VALIDATION_FAILED,
        400,
        `Valid modality query parameter is required (${Object.values(Modality).join(', ')})`,
      );
    }
    return this.filesService.contextPreview(projectId, {
      modality: modality as Modality,
      pinned,
      rawPrompt,
    });
  }
}
