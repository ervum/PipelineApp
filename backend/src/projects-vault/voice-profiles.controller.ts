import {
  UpsertVoiceProfileDto,
  UpsertVoiceProfileSchema,
  VoiceProfileModel,
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
import { VoiceProfilesService } from './voice-profiles.service';

const PartialVoiceProfileSchema = UpsertVoiceProfileSchema.partial();

@Controller()
export class VoiceProfilesController {
  constructor(private readonly voiceProfilesService: VoiceProfilesService) {}

  @Get('projects/:id/voice-profiles')
  async list(@Param('id') projectId: string): Promise<VoiceProfileModel[]> {
    return this.voiceProfilesService.list(projectId);
  }

  @Post('projects/:id/voice-profiles')
  async create(
    @Param('id') projectId: string,
    @ZodBody(UpsertVoiceProfileSchema) dto: UpsertVoiceProfileDto,
  ): Promise<VoiceProfileModel> {
    return this.voiceProfilesService.create(projectId, dto);
  }

  @Patch('voice-profiles/:voiceId')
  async update(
    @Param('voiceId') voiceId: string,
    @ZodBody(PartialVoiceProfileSchema) dto: Partial<UpsertVoiceProfileDto>,
  ): Promise<VoiceProfileModel> {
    return this.voiceProfilesService.update(voiceId, dto);
  }

  @Delete('voice-profiles/:voiceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('voiceId') voiceId: string): Promise<void> {
    await this.voiceProfilesService.delete(voiceId);
  }
}
