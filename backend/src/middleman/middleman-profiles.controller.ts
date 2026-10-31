import {
  MiddlemanProfileModel,
  UpsertMiddlemanProfileDto,
  UpsertMiddlemanProfileSchema,
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
} from '@nestjs/common';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import { MiddlemanProfilesService } from './middleman-profiles.service';

const PartialMiddlemanProfileSchema = UpsertMiddlemanProfileSchema.partial();

@Controller('middleman/profiles')
export class MiddlemanProfilesController {
  constructor(private readonly profilesService: MiddlemanProfilesService) {}

  @Get()
  async list(): Promise<MiddlemanProfileModel[]> {
    return this.profilesService.list();
  }

  @Post()
  async create(
    @ZodBody(UpsertMiddlemanProfileSchema) dto: UpsertMiddlemanProfileDto,
  ): Promise<MiddlemanProfileModel> {
    return this.profilesService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @ZodBody(PartialMiddlemanProfileSchema) dto: Partial<UpsertMiddlemanProfileDto>,
  ): Promise<MiddlemanProfileModel> {
    return this.profilesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(@Param('id') id: string): Promise<void> {
    await this.profilesService.delete(id);
  }
}
