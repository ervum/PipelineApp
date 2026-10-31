import {
  ConfigureSyncDirectoryDto,
  ConfigureSyncDirectorySchema,
  CreateProjectDto,
  CreateProjectSchema,
  ExportProjectBundleDto,
  ExportProjectBundleSchema,
  ProjectModel,
  UpdateProjectDto,
  UpdateProjectSchema,
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
  Put,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { UploadedMulterFile } from '../common/types/multer-file.interface';
import { EngineExportService, SyncConfigState } from './engine-export.service';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly engineExportService: EngineExportService,
  ) {}

  @Get()
  async list(@Query('includeArchived') includeArchived?: string): Promise<ProjectModel[]> {
    return this.projectsService.list(includeArchived === 'true' || includeArchived === '1');
  }

  @Post()
  async create(@ZodBody(CreateProjectSchema) dto: CreateProjectDto): Promise<ProjectModel> {
    return this.projectsService.create(dto);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<ProjectModel> {
    return this.projectsService.get(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @ZodBody(UpdateProjectSchema) dto: UpdateProjectDto,
  ): Promise<ProjectModel> {
    return this.projectsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.projectsService.delete(id);
  }

  @Post(':id/cover')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 },
    }),
  )
  async uploadCover(
    @Param('id') id: string,
    @UploadedFile() file?: UploadedMulterFile,
  ): Promise<ProjectModel> {
    return this.projectsService.uploadCover(id, file);
  }

  @Post(':id/export')
  async exportBundle(
    @Param('id') id: string,
    @ZodBody(ExportProjectBundleSchema) dto: ExportProjectBundleDto,
    @Query('format') format: string | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const result = await this.engineExportService.exportProjectBundle(id, dto);
    if (format === 'json' || dto.syncToDir) {
      res.status(HttpStatus.OK).json({
        projectId: result.projectId,
        projectSlug: result.projectSlug,
        targetEngine: result.targetEngine,
        assetCount: result.assetCount,
        fileCount: result.fileCount,
        files: result.files,
        syncedToDir: result.syncedToDir,
      });
      return;
    }

    const fileName = `${result.projectSlug}-${result.targetEngine.toLowerCase()}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Length', String(result.zipBuffer.length));
    res.status(HttpStatus.OK).send(result.zipBuffer);
  }

  @Get(':id/sync-config')
  async getSyncConfig(@Param('id') id: string): Promise<SyncConfigState | null> {
    return this.engineExportService.getSyncConfig(id);
  }

  @Put(':id/sync-config')
  async configureSyncDirectory(
    @Param('id') id: string,
    @ZodBody(ConfigureSyncDirectorySchema) dto: ConfigureSyncDirectoryDto,
  ): Promise<SyncConfigState> {
    return this.engineExportService.configureSyncDirectory(id, dto);
  }
}
