import {
  AssetFileRole,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { HttpClientService } from '../../../common/http/http-client.service';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import {
  GeneratorDispatchContext,
  GeneratorOutput,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

@Injectable()
export class StabilityImageAdapter extends BaseGeneratorAdapter {
  readonly id = 'stability-image';
  readonly providerKind = ProviderKind.STABILITY;
  readonly modalities = [Modality.IMAGES, Modality.ICONS_2D] as const;
  readonly subModes = [GenerationSubMode.STANDARD] as const;
  readonly tier = ExecutionTier.CLOUD_API;

  constructor(private readonly http: HttpClientService) {
    super();
  }

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const baseUrl = (
      ctx.provider.baseUrl || 'https://api.stability.ai'
    ).replace(/\/$/, '');
    const headers: Record<string, string> = {
      ...this.authHeaders(ctx.provider, 'Bearer'),
      Accept: 'image/*',
    };

    const rawModel = this.pickModel(ctx, 'sd3.5-large');
    const endpoint =
      rawModel === 'ultra'
        ? 'ultra'
        : rawModel === 'core'
          ? 'core'
          : 'sd3';

    const dims = this.sizeFor(ctx.params);
    const batchCount =
      'batchCount' in ctx.params && typeof ctx.params.batchCount === 'number'
        ? Math.max(1, ctx.params.batchCount)
        : 1;

    const outputs: GeneratorOutput[] = [];
    for (let i = 0; i < batchCount; i++) {
      const form = new FormData();
      form.append('prompt', ctx.compiled.enhancedPrompt);
      if (ctx.compiled.negativePrompt.trim().length > 0) {
        form.append('negative_prompt', ctx.compiled.negativePrompt.trim());
      }
      form.append('output_format', 'png');
      form.append('seed', String((ctx.seed + i) % 2147483647));

      if (endpoint === 'sd3') {
        form.append(
          'model',
          rawModel.startsWith('sd3') ? rawModel : 'sd3.5-large',
        );
      }

      if (ctx.references.length > 0) {
        const ref = ctx.references[0]!;
        const b64 = await ref.base64();
        const buf = Buffer.from(b64, 'base64');
        form.append('mode', 'image-to-image');
        form.append(
          'image',
          new Blob([buf], { type: ref.mimeType }),
          'reference.png',
        );
        const strength =
          ctx.params.modality === Modality.IMAGES
            ? (ctx.params.referenceStrength ?? 0.65)
            : 0.65;
        form.append('strength', String(strength));
      } else {
        form.append('aspect_ratio', dims.aspectRatio);
      }

      const buffer = await this.http.request<Buffer>(
        `${baseUrl}/v2beta/stable-image/generate/${endpoint}`,
        {
          method: 'POST',
          headers,
          body: form,
          responseType: 'buffer',
          timeoutMs: ctx.provider.settings.timeoutMs,
          signal: ctx.signal,
        },
      );

      outputs.push({
        kind: 'buffer',
        data: buffer,
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
}
