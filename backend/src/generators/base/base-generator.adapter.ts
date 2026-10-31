import {
  AdapterDescriptor,
  ASPECT_DIMENSIONS,
  ErrorCode,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ModalityParams,
  ParamSpec,
  ProviderKind,
} from '@forge/shared';
import { DomainError } from '../../common/errors/domain.error';
import { ProviderRuntimeConfig } from '../../providers/providers.service';
import {
  GeneratorDispatchContext,
  GeneratorPollResult,
  GeneratorSubmitResult,
  IGeneratorAdapter,
} from '../generator-adapter.interface';
import { standardParamSpecs } from './param-spec.helpers';

export abstract class BaseGeneratorAdapter implements IGeneratorAdapter {
  abstract readonly id: string;
  abstract readonly providerKind: ProviderKind;
  abstract readonly modalities: readonly Modality[];
  abstract readonly subModes: readonly GenerationSubMode[];
  abstract readonly tier: ExecutionTier | 'ANY';
  readonly supportsNativeTransparency?: boolean;

  abstract submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult>;

  poll?(
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
  ): Promise<GeneratorPollResult>;

  cancel?(
    ctx: GeneratorDispatchContext,
    handle: Record<string, unknown>,
  ): Promise<void>;

  describe(
    modality: Modality,
    subMode: GenerationSubMode = GenerationSubMode.STANDARD,
    _provider?: ProviderRuntimeConfig,
  ): AdapterDescriptor {
    const supportsNegativePrompt =
      this.providerKind !== ProviderKind.GEMINI &&
      (modality === Modality.ICONS_2D ||
        modality === Modality.IMAGES ||
        modality === Modality.ASSETS_3D ||
        subMode === GenerationSubMode.SPRITESHEET ||
        subMode === GenerationSubMode.VFX_TEXTURE);

    return {
      adapterId: this.id,
      providerKind: this.providerKind,
      modality,
      subModes: [...this.subModes],
      supportsNegativePrompt,
      supportsSeed: true,
      supportsReferenceImage:
        modality === Modality.ICONS_2D ||
        modality === Modality.IMAGES ||
        modality === Modality.ASSETS_3D,
      supportsBatch:
        modality === Modality.ICONS_2D ||
        modality === Modality.IMAGES ||
        modality === Modality.SFX,
      maxPromptChars: modality === Modality.VOICES ? 1200 : 2000,
      paramSpecs: this.paramSpecsFor(modality, subMode),
    };
  }

  protected paramSpecsFor(
    modality: Modality,
    subMode: GenerationSubMode,
  ): ParamSpec[] {
    return standardParamSpecs(modality, subMode);
  }

  protected requireSecret(provider: ProviderRuntimeConfig): string {
    if (!provider.secret || provider.secret.trim().length === 0) {
      throw new DomainError(
        ErrorCode.PROVIDER_NOT_CONFIGURED,
        400,
        `API key / secret is not configured for provider "${provider.name}" (${provider.kind})`,
      );
    }
    return provider.secret;
  }

  protected authHeaders(
    provider: ProviderRuntimeConfig,
    scheme: 'Bearer' | 'Key' | 'xi-api-key' | 'X-API-Key' | 'none' = 'Bearer',
  ): Record<string, string> {
    const headers: Record<string, string> = {
      ...provider.extraHeaders,
    };
    if (scheme === 'none') {
      return headers;
    }
    const secret = this.requireSecret(provider);
    if (scheme === 'Bearer') {
      headers['Authorization'] = `Bearer ${secret}`;
    } else if (scheme === 'Key') {
      headers['Authorization'] = `Key ${secret}`;
    } else if (scheme === 'xi-api-key') {
      headers['xi-api-key'] = secret;
    } else if (scheme === 'X-API-Key') {
      headers['X-API-Key'] = secret;
    }
    return headers;
  }

  protected foldNegative(prompt: string, negative: string): string {
    const cleanNeg = negative.trim();
    return cleanNeg.length > 0 ? `${prompt}. Avoid: ${cleanNeg}` : prompt;
  }

  protected pickModel(ctx: GeneratorDispatchContext, fallback: string): string {
    if (ctx.job.providerModel && ctx.job.providerModel.trim().length > 0) {
      return ctx.job.providerModel.trim();
    }
    if (
      ctx.provider.defaultModel &&
      ctx.provider.defaultModel.trim().length > 0
    ) {
      return ctx.provider.defaultModel.trim();
    }
    return fallback;
  }

  protected sizeFor(params: ModalityParams): {
    width: number;
    height: number;
    aspectRatio: string;
  } {
    if (params.modality === Modality.ICONS_2D) {
      const sz = params.outputSize ?? 1024;
      return { width: sz, height: sz, aspectRatio: '1:1' };
    }
    if (params.modality === Modality.IMAGES) {
      const preset = params.aspectPreset ?? 'SQUARE_1_1';
      const dims = ASPECT_DIMENSIONS[preset] ?? ASPECT_DIMENSIONS.SQUARE_1_1;
      return { width: dims.width, height: dims.height, aspectRatio: dims.ratio };
    }
    if (params.modality === Modality.OTHER) {
      if (params.subMode === GenerationSubMode.SPRITESHEET) {
        const frameSize = params.spritesheet.frameSize ?? 128;
        const cols = params.spritesheet.columns ?? 4;
        const frameCount = params.spritesheet.frameCount ?? 16;
        const rows = Math.max(1, Math.ceil(frameCount / cols));
        return {
          width: frameSize * cols,
          height: frameSize * rows,
          aspectRatio: `${cols}:${rows}`,
        };
      }
      if (params.subMode === GenerationSubMode.VFX_TEXTURE) {
        const res = params.vfx.resolution ?? 1024;
        return { width: res, height: res, aspectRatio: '1:1' };
      }
    }
    return { width: 1024, height: 1024, aspectRatio: '1:1' };
  }

  protected num(
    mergedParams: Record<string, unknown>,
    key: string,
    fallback: number,
  ): number {
    const val = mergedParams[key];
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val;
    }
    if (typeof val === 'string' && val.trim().length > 0) {
      const parsed = Number(val);
      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
    return fallback;
  }

  protected str(
    mergedParams: Record<string, unknown>,
    key: string,
    fallback: string,
  ): string {
    const val = mergedParams[key];
    if (typeof val === 'string' && val.trim().length > 0) {
      return val;
    }
    return fallback;
  }

  protected bool(
    mergedParams: Record<string, unknown>,
    key: string,
    fallback: boolean,
  ): boolean {
    const val = mergedParams[key];
    if (typeof val === 'boolean') {
      return val;
    }
    if (val === 'true') return true;
    if (val === 'false') return false;
    return fallback;
  }
}
