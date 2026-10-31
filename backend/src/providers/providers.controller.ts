import {
  AdapterDescriptor,
  GOOGLE_WEB_MODEL_CATALOG,
  GoogleWebModelDefinition,
  InterpolationResult,
  ProviderCatalogEntry,
  ProviderConfigModel,
  TemplatePreviewDto,
  TemplatePreviewSchema,
  UpsertProviderDto,
  UpsertProviderSchema,
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
} from '@nestjs/common';
import { WebChatSession } from '@prisma/client';
import { ZodBody } from '../common/decorators/zod-body.decorator';
import {
  GoogleWebBrowserService,
  GoogleWebStatusDto,
} from './google-web/google-web-browser.service';
import { ProviderHealthService } from './provider-health.service';
import { ProvidersService } from './providers.service';

@Controller('providers')
export class ProvidersController {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly healthService: ProviderHealthService,
    private readonly googleWebBrowser: GoogleWebBrowserService,
  ) {}

  @Get()
  async list(): Promise<ProviderConfigModel[]> {
    return this.providersService.list();
  }

  @Get('catalog')
  catalog(): ProviderCatalogEntry[] {
    return this.providersService.catalog();
  }

  // ─────────────── Google Web & AI Studio Browser Automation Endpoints ───────────────

  @Get('google-web/models')
  googleWebModels(): readonly GoogleWebModelDefinition[] {
    return GOOGLE_WEB_MODEL_CATALOG;
  }

  @Get('google-web/status')
  async googleWebStatus(): Promise<GoogleWebStatusDto> {
    return this.googleWebBrowser.getStatus();
  }

  @Post('google-web/login')
  @HttpCode(HttpStatus.OK)
  async googleWebLogin(
    @Body() body?: { target?: 'gemini' | 'aistudio' },
  ): Promise<{ url: string; visible: boolean }> {
    const target = body?.target === 'gemini' ? 'gemini' : 'aistudio';
    return this.googleWebBrowser.openInteractiveLogin(target);
  }

  @Post('google-web/browser-visibility')
  @HttpCode(HttpStatus.OK)
  async setBrowserVisibility(
    @Body() body: { visible?: boolean },
  ): Promise<{ visible: boolean }> {
    return this.googleWebBrowser.setBrowserVisibility(Boolean(body?.visible));
  }

  @Post('google-web/answer-now')
  @HttpCode(HttpStatus.OK)
  async triggerAnswerNow(
    @Body() body?: { jobId?: string },
  ): Promise<{ clicked: boolean; message: string }> {
    return this.googleWebBrowser.triggerAnswerNow(body?.jobId);
  }

  @Get('google-web/chats')
  async listTrackedWebChats(): Promise<WebChatSession[]> {
    return this.googleWebBrowser.listTrackedChats();
  }

  @Delete('google-web/chats/last-run')
  @HttpCode(HttpStatus.OK)
  async deleteLastRunWebChats(): Promise<{ deletedCount: number }> {
    return this.googleWebBrowser.deleteLastRunWebChats();
  }

  @Delete('google-web/chats/all')
  @HttpCode(HttpStatus.OK)
  async deleteAllTrackedWebChats(): Promise<{ deletedCount: number }> {
    return this.googleWebBrowser.deleteAllTrackedWebChats();
  }

  @Delete('google-web/chats/job/:jobId')
  @HttpCode(HttpStatus.OK)
  async deleteWebChatsForJob(
    @Param('jobId') jobId: string,
  ): Promise<{ deletedCount: number }> {
    return this.googleWebBrowser.deleteWebChatsForJob(jobId);
  }

  @Delete('google-web/chats/:chatId')
  @HttpCode(HttpStatus.OK)
  async deleteWebChatById(
    @Param('chatId') chatId: string,
  ): Promise<{ deleted: boolean }> {
    return this.googleWebBrowser.deleteWebChatById(chatId);
  }

  @Post()
  async create(@ZodBody(UpsertProviderSchema) dto: UpsertProviderDto): Promise<ProviderConfigModel> {
    return this.providersService.create(dto);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ): Promise<ProviderConfigModel> {
    return this.providersService.update(id, body ?? {});
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.providersService.delete(id);
  }

  @Post(':id/health')
  @HttpCode(HttpStatus.OK)
  async checkHealth(@Param('id') id: string): Promise<ProviderConfigModel> {
    return this.healthService.check(id);
  }

  @Get(':id/adapters')
  async adapters(@Param('id') id: string): Promise<AdapterDescriptor[]> {
    return this.providersService.adapters(id);
  }

  @Post('template-preview')
  @HttpCode(HttpStatus.OK)
  previewTemplate(@ZodBody(TemplatePreviewSchema) dto: TemplatePreviewDto): InterpolationResult {
    return this.providersService.previewTemplate(dto);
  }
}
