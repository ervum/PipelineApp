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
}
