import { Module } from '@nestjs/common';
import { GeneratorsModule } from '../generators/generators.module';
import { ProjectsVaultModule } from '../projects-vault/projects-vault.module';
import { StorageModule } from '../storage/storage.module';
import { AssetsController } from './assets.controller';
import { AssetsService } from './assets.service';

@Module({
  imports: [StorageModule, ProjectsVaultModule, GeneratorsModule],
  controllers: [AssetsController],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
