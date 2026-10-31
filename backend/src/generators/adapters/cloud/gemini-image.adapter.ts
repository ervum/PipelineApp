import {
  AdapterDescriptor,
  AssetFileRole,
  ErrorCode,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ParamSpec,
  ProviderKind,
} from '@forge/shared';
import { GoogleGenAI, Interactions } from '@google/genai';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';
import { ProviderRuntimeConfig } from '../../../providers/providers.service';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import { enumSpec } from '../../base/param-spec.helpers';
import {
  GeneratorDispatchContext,
  GeneratorOutput,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

@Injectable()
export class GeminiImageAdapter extends BaseGeneratorAdapter {
  readonly id = 'gemini-image';
  readonly providerKind = ProviderKind.GEMINI;
  readonly modalities = [
    Modality.ICONS_2D,
    Modality.IMAGES,
    Modality.OTHER,
  ] as const;
  readonly subModes = [
    GenerationSubMode.STANDARD,
    GenerationSubMode.SPRITESHEET,
    GenerationSubMode.VFX_TEXTURE,
  ] as const;
  readonly tier = ExecutionTier.CLOUD_API;

  override describe(
    modality: Modality,
    subMode: GenerationSubMode = GenerationSubMode.STANDARD,
    provider?: ProviderRuntimeConfig,
  ): AdapterDescriptor {
    const base = super.describe(modality, subMode, provider);
    return {
      ...base,
      supportsNegativePrompt: false,
      supportsSeed: false,
    };
  }

  protected override paramSpecsFor(
    _modality: Modality,
    _subMode: GenerationSubMode,
  ): ParamSpec[] {
    return [
      enumSpec({
        key: 'image_size',
        label: 'Image Size',
        options: [
          { value: '1K', label: '1K (Standard)' },
          { value: '2K', label: '2K (High Resolution)' },
        ],
        default: '1K',
        description: 'Output resolution tier for Gemini image generation',
        advanced: false,
      }),
    ];
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const apiKey = this.requireSecret(ctx.provider);
    const ai = new GoogleGenAI({ apiKey });

    const rawModel = this.pickModel(ctx, 'gemini-nano-banana-2.1');
    const model =
      rawModel.startsWith('gemini-2.') || rawModel === 'gemini-3.8-flash'
        ? 'gemini-nano-banana-2.1'
        : rawModel;

    const basePrompt = this.foldNegative(
      ctx.compiled.enhancedPrompt,
      ctx.compiled.negativePrompt,
    );

    const dims = this.sizeFor(ctx.params);
    const allowedAspectRatios = new Set([
      '1:1',
      '16:9',
      '9:16',
      '4:3',
      '3:4',
      '3:2',
      '2:3',
    ]);
    const aspectRatio = allowedAspectRatios.has(dims.aspectRatio)
      ? dims.aspectRatio
      : '1:1';
    const imageSize =
      this.str(ctx.mergedParams, 'image_size', '1K') === '2K' ? '2K' : '1K';

    const batchCount =
      'batchCount' in ctx.params && typeof ctx.params.batchCount === 'number'
        ? Math.max(1, ctx.params.batchCount)
        : 1;

    const refParts: Interactions.ImageContent[] = [];
    for (const ref of ctx.references) {
      const b64 = await ref.base64();
      refParts.push({
        type: 'image',
        data: b64,
        mime_type: ref.mimeType,
      });
    }

    const outputs: GeneratorOutput[] = [];
    for (let i = 0; i < batchCount; i++) {
      if (ctx.signal.aborted) {
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          499,
          'Gemini image generation cancelled',
        );
      }

      const promptText =
        batchCount > 1 ? `${basePrompt} (variation ${i + 1})` : basePrompt;

      const inputContent: Array<
        Interactions.TextContent | Interactions.ImageContent
      > = [{ type: 'text', text: promptText }, ...refParts];

      const responseFormat: Interactions.ImageResponseFormat = {
        type: 'image',
        aspect_ratio: aspectRatio,
        image_size: imageSize,
      };

      let interaction: Interactions.Interaction;
      try {
        interaction = await ai.interactions.create({
          model,
          input: inputContent,
          response_format: responseFormat,
          store: false,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/401|403|api_key|unauthenticated/i.test(msg)) {
          throw new DomainError(
            ErrorCode.PROVIDER_AUTH_FAILED,
            502,
            `Gemini auth failed: ${msg}`,
          );
        }
        if (/429|quota|rate/i.test(msg)) {
          throw new DomainError(
            ErrorCode.PROVIDER_RATE_LIMITED,
            429,
            `Gemini rate limited: ${msg}`,
          );
        }
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          `Gemini image generation failed: ${msg}`,
        );
      }

      const imageBlock = interaction.output_image;
      const base64Data = imageBlock?.data;
      const mimeType = imageBlock?.mime_type || 'image/png';

      if (!base64Data) {
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          'Gemini interaction returned no output_image data',
        );
      }

      outputs.push({
        kind: 'base64',
        data: base64Data,
        mimeType,
        fileName: `image_${i + 1}.png`,
        role: AssetFileRole.PRIMARY,
        batchIndex: i,
      });
    }

    return {
      mode: 'sync',
      outputs,
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
