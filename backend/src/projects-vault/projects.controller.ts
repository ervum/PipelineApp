import {
  CreateProjectDto,
  CreateProjectSchema,
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
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { UploadedMulterFile } from '../common/types/multer-file.interface';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

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
}
