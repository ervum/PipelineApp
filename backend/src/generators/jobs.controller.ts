import {
  CreateJobDto,
  CreateJobSchema,
  JobEventModel,
  JobListQueryDto,
  JobListQuerySchema,
  JobModel,
  Paginated,
  RecompileDto,
  RecompileSchema,
  UpdateCompiledDto,
  UpdateCompiledSchema,
} from '@forge/shared';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ZodBody, ZodQuery } from '../common/decorators/zod-body.decorator';
import { JobsService } from './jobs.service';

@Controller('jobs')
export class JobsController {
  constructor(private readonly jobsService: JobsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(@ZodBody(CreateJobSchema) dto: CreateJobDto): Promise<JobModel> {
    return this.jobsService.create(dto);
  }

  @Get()
  async list(
    @ZodQuery(JobListQuerySchema) query: JobListQueryDto,
  ): Promise<Paginated<JobModel>> {
    return this.jobsService.list(query);
  }

  @Get(':id')
  async get(@Param('id') id: string): Promise<JobModel> {
    return this.jobsService.get(id);
  }

  @Get(':id/events')
  async events(@Param('id') id: string): Promise<JobEventModel[]> {
    return this.jobsService.events(id);
  }

  @Patch(':id/compiled')
  async updateCompiled(
    @Param('id') id: string,
    @ZodBody(UpdateCompiledSchema) dto: UpdateCompiledDto,
  ): Promise<JobModel> {
    return this.jobsService.updateCompiled(id, dto);
  }

  @Post(':id/recompile')
  @HttpCode(HttpStatus.OK)
  async recompile(
    @Param('id') id: string,
    @ZodBody(RecompileSchema) dto: RecompileDto,
  ): Promise<JobModel> {
    return this.jobsService.recompile(id, dto);
  }

  @Post(':id/dispatch')
  @HttpCode(HttpStatus.OK)
  async dispatch(@Param('id') id: string): Promise<JobModel> {
    return this.jobsService.dispatch(id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(@Param('id') id: string): Promise<JobModel> {
    return this.jobsService.cancel(id);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.OK)
  async retry(@Param('id') id: string): Promise<JobModel> {
    return this.jobsService.retry(id);
  }

  @Post(':id/duplicate')
  @HttpCode(HttpStatus.CREATED)
  async duplicate(@Param('id') id: string): Promise<JobModel> {
    return this.jobsService.duplicate(id);
  }
}
