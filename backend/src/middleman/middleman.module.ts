import { Module } from '@nestjs/common';
import { ProjectsVaultModule } from '../projects-vault/projects-vault.module';
import { ProvidersModule } from '../providers/providers.module';
import { StorageModule } from '../storage/storage.module';
import { CompiledOutputParser } from './compiled-output.parser';
import { ContextAssemblerService } from './context-assembler.service';
import { LlmModule } from './llm/llm.module';
import { MiddlemanCompilerService } from './middleman-compiler.service';
import { MiddlemanProfilesController } from './middleman-profiles.controller';
import { MiddlemanProfilesService } from './middleman-profiles.service';
import { MiddlemanTemplatesController } from './middleman-templates.controller';
import { MiddlemanTemplatesService } from './middleman-templates.service';
import { SystemPromptBuilder } from './system-prompt.builder';

@Module({
  imports: [LlmModule, ProvidersModule, ProjectsVaultModule, StorageModule],
  controllers: [MiddlemanProfilesController, MiddlemanTemplatesController],
  providers: [
    MiddlemanProfilesService,
    MiddlemanTemplatesService,
    MiddlemanCompilerService,
    ContextAssemblerService,
    SystemPromptBuilder,
    CompiledOutputParser,
  ],
  exports: [
    MiddlemanProfilesService,
    MiddlemanTemplatesService,
    MiddlemanCompilerService,
    ContextAssemblerService,
    SystemPromptBuilder,
    CompiledOutputParser,
  ],
})
export class MiddlemanModule {}
