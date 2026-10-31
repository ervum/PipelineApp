import { Module } from '@nestjs/common';
import { AppConfigService } from '../config/app-config.service';
import { GoogleWebAudioRunner } from './google-web/google-web-audio.runner';
import { GoogleWebBrowserService } from './google-web/google-web-browser.service';
import { GoogleWebImageRunner } from './google-web/google-web-image.runner';
import { GoogleWebTextRunner } from './google-web/google-web-text.runner';
import { GoogleWebVideoRunner } from './google-web/google-web-video.runner';
import { ProviderHealthService } from './provider-health.service';
import { ProvidersController } from './providers.controller';
import { ProvidersService } from './providers.service';
import { SecretCipherService } from './secret-cipher.service';

@Module({
  controllers: [ProvidersController],
  providers: [
    {
      provide: SecretCipherService,
      useFactory: (cfg: AppConfigService): SecretCipherService =>
        new SecretCipherService(cfg.forgeMasterKey),
      inject: [AppConfigService],
    },
    ProvidersService,
    ProviderHealthService,
    GoogleWebBrowserService,
    GoogleWebTextRunner,
    GoogleWebImageRunner,
    GoogleWebVideoRunner,
    GoogleWebAudioRunner,
  ],
  exports: [
    SecretCipherService,
    ProvidersService,
    ProviderHealthService,
    GoogleWebBrowserService,
    GoogleWebTextRunner,
    GoogleWebImageRunner,
    GoogleWebVideoRunner,
    GoogleWebAudioRunner,
  ],
})
export class ProvidersModule {}
