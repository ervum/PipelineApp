import {
  AssetListQueryDto,
  AssetListQuerySchema,
  AssetModel,
  ExecutionMode,
  JobModel,
  Paginated,
  SaveAssetToVaultDto,
  SaveAssetToVaultSchema,
  UpdateAssetDto,
  UpdateAssetSchema,
  VaultFileModel,
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
import { z } from 'zod';
import { ZodBody, ZodQuery } from '../common/decorators/zod-body.decorator';
import { AssetsService } from './assets.service';

const CreateVariationSchema = z.object({
  executionMode: z
    .enum(['AUTO_FIRE', 'INTERCEPT'])
    .default(ExecutionMode.AUTO_FIRE),
});

type CreateVariationDto = z.infer<typeof CreateVariationSchema>;

const PaletteRemapSchema = z.object({
  targetPaletteHex: z.array(z.string()).optional(),
  strength: z.number().min(0).max(1).optional(),
});

type PaletteRemapDto = z.infer<typeof PaletteRemapSchema>;

const ReviseAssetSchema = z.object({
  contentText: z.string().min(1).max(500_000),
  title: z.string().max(160).optional(),
  notes: z.string().max(4000).optional(),
});
type ReviseAssetDto = z.infer<typeof ReviseAssetSchema>;

const AudioEditSchema = z.object({
  trimStartMs: z.number().min(0).optional(),
  trimEndMs: z.number().min(0).optional(),
  crossfadeMs: z.number().min(0).max(10_000).optional(),
  normalizePeakDb: z.number().min(-24).max(0).optional(),
});
type AudioEditDto = z.infer<typeof AudioEditSchema>;

const DerivePbrSchema = z.object({
  normalStrength: z.number().min(0.2).max(10).optional(),
});
type DerivePbrDto = z.infer<typeof DerivePbrSchema>;

@Controller('assets')
export class AssetsController {
  constructor(private readonly assetsService: AssetsService) {}

  @Get()
  async list(
    @ZodQuery(AssetListQuerySchema) query: AssetListQueryDto,
  ): Promise<Paginated<AssetModel>> {
    return this.assetsService.list(query);
  }

  @Get(':id')
  async get(
    @Param('id') id: string,
  ): Promise<AssetModel & { lineage: AssetModel[] }> {
    return this.assetsService.get(id);
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @ZodBody(UpdateAssetSchema) dto: UpdateAssetDto,
  ): Promise<AssetModel> {
    return this.assetsService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string): Promise<void> {
    await this.assetsService.delete(id);
  }

  @Post(':id/save-to-vault')
  @HttpCode(HttpStatus.CREATED)
  async saveToVault(
    @Param('id') id: string,
    @ZodBody(SaveAssetToVaultSchema) dto: SaveAssetToVaultDto,
  ): Promise<VaultFileModel> {
    return this.assetsService.saveToVault(id, dto);
  }

  @Post(':id/variation')
  @HttpCode(HttpStatus.CREATED)
  async variation(
    @Param('id') id: string,
    @ZodBody(CreateVariationSchema) dto: CreateVariationDto,
  ): Promise<JobModel> {
    return this.assetsService.createVariation(
      id,
      dto.executionMode as ExecutionMode,
    );
  }

  @Post(':id/palette-remap')
  @HttpCode(HttpStatus.CREATED)
  async remapPalette(
    @Param('id') id: string,
    @ZodBody(PaletteRemapSchema) dto: PaletteRemapDto,
  ): Promise<AssetModel> {
    return this.assetsService.remapPalette(id, dto);
  }

  @Post(':id/revise')
  @HttpCode(HttpStatus.CREATED)
  async revise(
    @Param('id') id: string,
    @ZodBody(ReviseAssetSchema) dto: ReviseAssetDto,
  ): Promise<AssetModel> {
    return this.assetsService.reviseTextAsset(id, dto);
  }

  @Post(':id/audio-edit')
  @HttpCode(HttpStatus.CREATED)
  async audioEdit(
    @Param('id') id: string,
    @ZodBody(AudioEditSchema) dto: AudioEditDto,
  ): Promise<AssetModel> {
    return this.assetsService.editAudioAsset(id, dto);
  }

  @Post(':id/derive-pbr')
  @HttpCode(HttpStatus.CREATED)
  async derivePbr(
    @Param('id') id: string,
    @ZodBody(DerivePbrSchema) dto: DerivePbrDto,
  ): Promise<AssetModel> {
    return this.assetsService.derivePbrMaps(id, dto);
  }
}
