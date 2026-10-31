import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { AppConfigService } from './config/app-config.service';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: true,
  });
  const cfg = app.get(AppConfigService);

  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  app.enableCors({ origin: cfg.corsOrigin, credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useBodyParser('json', { limit: '25mb' });
  app.useWebSocketAdapter(new IoAdapter(app));
  app.enableShutdownHooks();

  await app.listen(cfg.port);
  Logger.log(
    `ForgeStudio Control Room API listening on http://localhost:${cfg.port}`,
    'Bootstrap',
  );
}

void bootstrap();
