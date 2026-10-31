import { Module } from '@nestjs/common';
import { AssetsModule } from '../assets/assets.module';
import { GeneratorsModule } from '../generators/generators.module';
import { MiddlemanModule } from '../middleman/middleman.module';
import { ProjectsVaultModule } from '../projects-vault/projects-vault.module';
import { ProvidersModule } from '../providers/providers.module';
import { StorageModule } from '../storage/storage.module';
import { McpToolsService } from './mcp-tools.service';
import { McpController } from './mcp.controller';

@Module({
  imports: [
    GeneratorsModule,
    AssetsModule,
    ProjectsVaultModule,
    MiddlemanModule,
    ProvidersModule,
    StorageModule,
  ],
  controllers: [McpController],
  providers: [McpToolsService, McpController],
  exports: [McpToolsService, McpController],
})
export class McpModule {}
