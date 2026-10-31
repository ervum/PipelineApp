import {
  CompilePreviewDto,
  CompilePreviewResult,
  CompilePreviewSchema,
  MiddlemanTemplateModel,
  Modality,
  UpsertMiddlemanTemplateDto,
  UpsertMiddlemanTemplateSchema,
} from '@forge/shared';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { MiddlemanCompilerService } from './middleman-compiler.service';
import { MiddlemanTemplatesService } from './middleman-templates.service';

@Controller('middleman')
export class MiddlemanTemplatesController {
  constructor(
    private readonly templatesService: MiddlemanTemplatesService,
    private readonly compilerService: MiddlemanCompilerService,
  ) {}

  @Get('templates')
  async list(
    @Query('modality') modality?: Modality,
    @Query('projectId') projectId?: string,
  ): Promise<MiddlemanTemplateModel[]> {
    return this.templatesService.list({ modality, projectId });
  }

  @Post('templates')
  async create(
    @ZodBody(UpsertMiddlemanTemplateSchema) dto: UpsertMiddlemanTemplateDto,
  ): Promise<MiddlemanTemplateModel> {
    return this.templatesService.createVersion(dto);
  }

  @Patch('templates/:id/activate')
  async activate(@Param('id') id: string): Promise<MiddlemanTemplateModel> {
    return this.templatesService.activate(id);
  }

  @Post('compile-preview')
  @HttpCode(HttpStatus.OK)
  async compilePreview(
    @ZodBody(CompilePreviewSchema) dto: CompilePreviewDto,
  ): Promise<CompilePreviewResult> {
    return this.compilerService.preview(dto);
  }
}
