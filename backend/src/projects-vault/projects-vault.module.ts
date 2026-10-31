import { Module } from '@nestjs/common';
import { ContextAssemblerService } from '../middleman/context-assembler.service';
import { LlmModule } from '../middleman/llm/llm.module';
import { ProvidersModule } from '../providers/providers.module';
import { StorageModule } from '../storage/storage.module';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { VaultContextService } from './vault-context.service';
import { VaultFilesController } from './vault-files.controller';
import { VaultFilesService } from './vault-files.service';
import { VaultFoldersController } from './vault-folders.controller';
import { VaultFoldersService } from './vault-folders.service';
import { VisionAnalysisService } from './vision-analysis.service';
import { VoiceProfilesController } from './voice-profiles.controller';
import { VoiceProfilesService } from './voice-profiles.service';

@Module({
  imports: [StorageModule, ProvidersModule, LlmModule],
  controllers: [
    ProjectsController,
    VaultFoldersController,
    VaultFilesController,
    VoiceProfilesController,
  ],
  providers: [
    ProjectsService,
    VaultFoldersService,
    VaultFilesService,
    VoiceProfilesService,
    VaultContextService,
    VisionAnalysisService,
    ContextAssemblerService,
  ],
  exports: [
    ProjectsService,
    VaultFoldersService,
    VaultFilesService,
    VoiceProfilesService,
    VaultContextService,
    VisionAnalysisService,
    ContextAssemblerService,
  ],
})
export class ProjectsVaultModule {}
