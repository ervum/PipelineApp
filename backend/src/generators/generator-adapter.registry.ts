import {
  AdapterDescriptor,
  ErrorCode,
  GenerationSubMode,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { Inject, Injectable } from '@nestjs/common';
import { DomainError } from '../common/errors/domain.error';
import {
  GeneratorAdapterRegistryPort,
  ProviderRuntimeConfig,
} from '../providers/providers.service';
import {
  GENERATOR_ADAPTERS,
  IGeneratorAdapter,
} from './generator-adapter.interface';

@Injectable()
export class GeneratorAdapterRegistry implements GeneratorAdapterRegistryPort {
  constructor(
    @Inject(GENERATOR_ADAPTERS)
    private readonly adapters: IGeneratorAdapter[],
  ) {}

  private matchesKind(adapter: IGeneratorAdapter, kind: ProviderKind): boolean {
    if (adapter.providerKind === kind) {
      return true;
    }
    if (adapter.supportedProviderKinds?.includes(kind)) {
      return true;
    }
    return false;
  }

  resolve(
    kind: ProviderKind,
    modality: Modality,
    subMode: GenerationSubMode = GenerationSubMode.STANDARD,
  ): IGeneratorAdapter {
    const found = this.adapters.find(
      (adapter) =>
        this.matchesKind(adapter, kind) &&
        adapter.modalities.includes(modality) &&
        adapter.subModes.includes(subMode),
    );
    if (!found) {
      throw new DomainError(
        ErrorCode.MODALITY_UNSUPPORTED,
        400,
        `No generator adapter registered for provider kind "${kind}", modality "${modality}", subMode "${subMode}"`,
      );
    }
    return found;
  }

  describe(
    kind: ProviderKind,
    modality: Modality,
    subMode: GenerationSubMode = GenerationSubMode.STANDARD,
    provider?: ProviderRuntimeConfig,
  ): AdapterDescriptor {
    const adapter = this.resolve(kind, modality, subMode);
    const desc = adapter.describe(modality, subMode, provider);
    return {
      ...desc,
      providerKind: kind,
    };
  }

  describeForProvider(provider: ProviderRuntimeConfig): AdapterDescriptor[] {
    const results: AdapterDescriptor[] = [];
    const seen = new Set<string>();

    for (const modality of provider.modalities) {
      const candidateSubModes: GenerationSubMode[] =
        modality === Modality.ASSETS_3D
          ? [GenerationSubMode.TEXT_TO_3D, GenerationSubMode.IMAGE_TO_3D]
          : modality === Modality.VIDEO
            ? [
                GenerationSubMode.STANDARD,
                GenerationSubMode.TEXT_TO_VIDEO,
                GenerationSubMode.IMAGE_TO_VIDEO,
              ]
            : modality === Modality.OTHER
              ? [
                  GenerationSubMode.SPRITESHEET,
                  GenerationSubMode.VFX_TEXTURE,
                  GenerationSubMode.SHADER_CODE,
                  GenerationSubMode.LORE_JSON,
                ]
              : [GenerationSubMode.STANDARD];

      for (const subMode of candidateSubModes) {
        const matchingAdapter = this.adapters.find(
          (a) =>
            this.matchesKind(a, provider.kind) &&
            a.modalities.includes(modality) &&
            a.subModes.includes(subMode),
        );
        if (!matchingAdapter) {
          continue;
        }
        const key = `${matchingAdapter.id}:${modality}:${subMode}`;
        if (seen.has(key)) {
          continue;
        }
        seen.add(key);
        const desc = matchingAdapter.describe(modality, subMode, provider);
        results.push({
          ...desc,
          providerKind: provider.kind,
        });
      }
    }

    return results;
  }
}
