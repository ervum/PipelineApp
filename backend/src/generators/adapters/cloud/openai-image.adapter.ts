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
import { Injectable } from '@nestjs/common';
import { DomainError } from '../../../common/errors/domain.error';
import { HttpClientService } from '../../../common/http/http-client.service';
import { ProviderRuntimeConfig } from '../../../providers/providers.service';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import { enumSpec } from '../../base/param-spec.helpers';
import {
  GeneratorDispatchContext,
  GeneratorOutput,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

interface OpenAiImageResponse {
  data?: Array<{
    b64_json?: string;
    url?: string;
    revised_prompt?: string;
  }>;
}

@Injectable()
export class OpenAiImageAdapter extends BaseGeneratorAdapter {
  readonly id = 'openai-image';
  readonly providerKind = ProviderKind.OPENAI;
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
  override readonly supportsNativeTransparency = true;

  constructor(private readonly http: HttpClientService) {
    super();
  }

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
        key: 'quality',
        label: 'Render Quality',
        options: [
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
          { value: 'hd', label: 'HD' },
          { value: 'standard', label: 'Standard' },
        ],
        default: 'high',
        description: 'OpenAI image generation quality tier',
        advanced: false,
      }),
    ];
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const baseUrl = (ctx.provider.baseUrl || 'https://api.openai.com').replace(
      /\/$/,
      '',
    );
    const headers = this.authHeaders(ctx.provider, 'Bearer');
    const model = this.pickModel(ctx, 'gpt-image-1');
    const prompt = this.foldNegative(
      ctx.compiled.enhancedPrompt,
      ctx.compiled.negativePrompt,
    );

    const dims = this.sizeFor(ctx.params);
    const isLandscape = dims.width > dims.height;
    const isPortrait = dims.height > dims.width;

    const batchCount =
      'batchCount' in ctx.params && typeof ctx.params.batchCount === 'number'
        ? Math.max(1, ctx.params.batchCount)
        : 1;

    const removeBackground =
      (ctx.params.modality === Modality.ICONS_2D &&
        ctx.params.removeBackground !== false) ||
      (ctx.params.modality === Modality.OTHER &&
        ctx.params.subMode === GenerationSubMode.SPRITESHEET);

    const rawQuality = this.str(ctx.mergedParams, 'quality', 'high');

    if (model === 'dall-e-3') {
      const size = isLandscape
        ? '1792x1024'
        : isPortrait
          ? '1024x1792'
          : '1024x1024';
      const quality =
        rawQuality === 'hd' || rawQuality === 'high' ? 'hd' : 'standard';

      const outputs: GeneratorOutput[] = [];
      for (let i = 0; i < batchCount; i++) {
        const res = await this.http.request<OpenAiImageResponse>(
          `${baseUrl}/v1/images/generations`,
          {
            method: 'POST',
            headers,
            body: {
              model: 'dall-e-3',
              prompt:
                batchCount > 1 ? `${prompt} (variation ${i + 1})` : prompt,
              n: 1,
              size,
              quality,
              response_format: 'b64_json',
            },
            timeoutMs: ctx.provider.settings.timeoutMs,
            signal: ctx.signal,
          },
        );
        const item = res.data?.[0];
        if (!item || (!item.b64_json && !item.url)) {
          throw new DomainError(
            ErrorCode.PROVIDER_ERROR,
            502,
            'OpenAI dall-e-3 returned empty image data',
          );
        }
        outputs.push({
          kind: item.b64_json ? 'base64' : 'url',
          data: item.b64_json ?? item.url ?? '',
          mimeType: 'image/png',
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

    const size = isLandscape
      ? '1536x1024'
      : isPortrait
        ? '1024x1536'
        : '1024x1024';
    const quality =
      rawQuality === 'low'
        ? 'low'
        : rawQuality === 'medium' || rawQuality === 'standard'
          ? 'medium'
          : 'high';
    const background = removeBackground ? 'transparent' : 'opaque';

    let res: OpenAiImageResponse;
    if (ctx.references.length > 0) {
      const form = new FormData();
      form.append('model', model);
      form.append('prompt', prompt);
      form.append('n', String(batchCount));
      form.append('size', size);
      form.append('quality', quality);
      form.append('background', background);
      for (let i = 0; i < ctx.references.length; i++) {
        const ref = ctx.references[i]!;
        const b64 = await ref.base64();
        const buf = Buffer.from(b64, 'base64');
        form.append(
          'image[]',
          new Blob([buf], { type: ref.mimeType }),
          `ref_${i}.png`,
        );
      }
      res = await this.http.request<OpenAiImageResponse>(
        `${baseUrl}/v1/images/edits`,
        {
          method: 'POST',
          headers,
          body: form,
          timeoutMs: ctx.provider.settings.timeoutMs,
          signal: ctx.signal,
        },
      );
    } else {
      res = await this.http.request<OpenAiImageResponse>(
        `${baseUrl}/v1/images/generations`,
        {
          method: 'POST',
          headers,
          body: {
            model,
            prompt,
            n: batchCount,
            size,
            quality,
            background,
            output_format: 'png',
          },
          timeoutMs: ctx.provider.settings.timeoutMs,
          signal: ctx.signal,
        },
      );
    }

    const items = res.data ?? [];
    if (items.length === 0) {
      throw new DomainError(
        ErrorCode.PROVIDER_ERROR,
        502,
        'OpenAI image endpoint returned no images',
      );
    }

    const outputs: GeneratorOutput[] = items.map((item, idx) => {
      if (!item.b64_json && !item.url) {
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          `OpenAI image item ${idx} missing b64_json and url`,
        );
      }
      return {
        kind: item.b64_json ? 'base64' : 'url',
        data: item.b64_json ?? item.url ?? '',
        mimeType: 'image/png',
        fileName: `image_${idx + 1}.png`,
        role: AssetFileRole.PRIMARY,
        batchIndex: idx,
      };
    });

    return {
      mode: 'sync',
      outputs,
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }
}
