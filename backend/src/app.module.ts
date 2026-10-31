import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AssetsModule } from './assets/assets.module';
import { AppConfigModule } from './config/app-config.module';
import { GeneratorsModule } from './generators/generators.module';
import { HealthController } from './health/health.controller';
import { McpModule } from './mcp/mcp.module';
import { MiddlemanModule } from './middleman/middleman.module';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { PrismaModule } from './prisma/prisma.module';
import { ProjectsVaultModule } from './projects-vault/projects-vault.module';
import { ProvidersModule } from './providers/providers.module';
import { StorageModule } from './storage/storage.module';

@Module({
  imports: [
    AppConfigModule,
    PrismaModule,
    ScheduleModule.forRoot(),
    OrchestratorModule,
    StorageModule,
    ProvidersModule,
    ProjectsVaultModule,
    MiddlemanModule,
    GeneratorsModule,
    AssetsModule,
    McpModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
