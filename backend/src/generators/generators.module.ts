import { Global, Module, OnModuleInit } from '@nestjs/common';
import { LlmModule } from '../middleman/llm/llm.module';
import { MiddlemanModule } from '../middleman/middleman.module';
import { ProvidersModule } from '../providers/providers.module';
import {
  GENERATOR_ADAPTER_REGISTRY_PORT,
  ProvidersService,
} from '../providers/providers.service';
import { StorageModule } from '../storage/storage.module';
import { CartesiaTtsAdapter } from './adapters/cloud/cartesia-tts.adapter';
import { ElevenLabsMusicAdapter } from './adapters/cloud/elevenlabs-music.adapter';
import { ElevenLabsSfxAdapter } from './adapters/cloud/elevenlabs-sfx.adapter';
import { ElevenLabsTtsAdapter } from './adapters/cloud/elevenlabs-tts.adapter';
import { FalImageAdapter } from './adapters/cloud/fal-image.adapter';
import { FishAudioTtsAdapter } from './adapters/cloud/fish-audio-tts.adapter';
import { GeminiImageAdapter } from './adapters/cloud/gemini-image.adapter';
import { GeminiTtsAdapter } from './adapters/cloud/gemini-tts.adapter';
import { GoogleWebGeneratorAdapter } from './adapters/cloud/google-web-generator.adapter';
import { LlmTextAdapter } from './adapters/cloud/llm-text.adapter';
import { MeshyAdapter } from './adapters/cloud/meshy.adapter';
import { OpenAiImageAdapter } from './adapters/cloud/openai-image.adapter';
import { OpenAiTtsAdapter } from './adapters/cloud/openai-tts.adapter';
import { ReplicateAdapter } from './adapters/cloud/replicate.adapter';
import { RodinAdapter } from './adapters/cloud/rodin.adapter';
import { StabilityAudioAdapter } from './adapters/cloud/stability-audio.adapter';
import { StabilityImageAdapter } from './adapters/cloud/stability-image.adapter';
import { Tripo3dAdapter } from './adapters/cloud/tripo3d.adapter';
import { DemoSynthAdapter } from './adapters/demo/demo-synth.adapter';
import { A1111Adapter } from './adapters/local/a1111.adapter';
import { ComfyUiAdapter } from './adapters/local/comfyui.adapter';
import { GenericHttpAdapter } from './adapters/local/generic-http.adapter';
import { OpenAiCompatibleTtsAdapter } from './adapters/local/openai-compatible-tts.adapter';
import { RunPodClient } from './adapters/runpod/runpod-client';
import { RunPodServerlessAdapter } from './adapters/runpod/runpod-serverless.adapter';
import { CostEstimatorService } from './cost-estimator.service';
import {
  GENERATOR_ADAPTERS,
  IGeneratorAdapter,
} from './generator-adapter.interface';
import { GeneratorAdapterRegistry } from './generator-adapter.registry';
import { JobProcessorService } from './job-processor.service';
import { JobStateService } from './job-state.service';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';
import { OutputIngestionService } from './output-ingestion.service';
import { AudioPostProcessor } from './post-processors/audio.post';
import { IconPostProcessor } from './post-processors/icon.post';
import { Model3dPostProcessor } from './post-processors/model3d.post';
import { SpritesheetPostProcessor } from './post-processors/spritesheet.post';
import { WebhooksController } from './webhooks.controller';

const ALL_ADAPTER_CLASSES = [
  DemoSynthAdapter,
  OpenAiImageAdapter,
  OpenAiTtsAdapter,
  GeminiImageAdapter,
  GeminiTtsAdapter,
  GoogleWebGeneratorAdapter,
  FalImageAdapter,
  ReplicateAdapter,
  StabilityImageAdapter,
  StabilityAudioAdapter,
  MeshyAdapter,
  Tripo3dAdapter,
  RodinAdapter,
  ElevenLabsTtsAdapter,
  ElevenLabsSfxAdapter,
  ElevenLabsMusicAdapter,
  CartesiaTtsAdapter,
  FishAudioTtsAdapter,
  RunPodServerlessAdapter,
  ComfyUiAdapter,
  A1111Adapter,
  OpenAiCompatibleTtsAdapter,
  GenericHttpAdapter,
  LlmTextAdapter,
] as const;

@Global()
@Module({
  imports: [LlmModule, ProvidersModule, MiddlemanModule, StorageModule],
  controllers: [JobsController, WebhooksController],
  providers: [
    RunPodClient,
    ...ALL_ADAPTER_CLASSES,
    {
      provide: GENERATOR_ADAPTERS,
      useFactory: (...adapters: IGeneratorAdapter[]): IGeneratorAdapter[] =>
        adapters,
      inject: [...ALL_ADAPTER_CLASSES],
    },
    GeneratorAdapterRegistry,
    {
      provide: GENERATOR_ADAPTER_REGISTRY_PORT,
      useExisting: GeneratorAdapterRegistry,
    },
    IconPostProcessor,
    SpritesheetPostProcessor,
    Model3dPostProcessor,
    AudioPostProcessor,
    CostEstimatorService,
    JobStateService,
    OutputIngestionService,
    JobProcessorService,
    JobsService,
  ],
  exports: [
    GeneratorAdapterRegistry,
    GENERATOR_ADAPTER_REGISTRY_PORT,
    JobStateService,
    JobProcessorService,
    JobsService,
    OutputIngestionService,
    CostEstimatorService,
  ],
})
export class GeneratorsModule implements OnModuleInit {
  constructor(
    private readonly providersService: ProvidersService,
    private readonly adapterRegistry: GeneratorAdapterRegistry,
  ) {}

  onModuleInit(): void {
    this.providersService.setAdapterRegistry(this.adapterRegistry);
  }
}
