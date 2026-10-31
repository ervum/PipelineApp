import {
  AssetFileRole,
  ExecutionTier,
  GENERATION_SUB_MODES,
  GenerationSubMode,
  MODALITIES,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { sleep } from '../../../common/utils/sleep';
import {
  MeshCategory,
  MeshPose,
  synthesizeGlbMesh,
} from '../../../synth/glb-mesh.synth';
import { mulberry32 } from '../../../synth/rng';
import {
  synthesizeArtPng,
  synthesizeSpritesheetPng,
} from '../../../synth/svg-art.synth';
import { synthesizeIconPng } from '../../../synth/svg-icon.synth';
import {
  synthesizeLoreJson,
  synthesizeLoreText,
  synthesizeShaderCode,
} from '../../../synth/text.synth';
import { synthesizeVideo } from '../../../synth/video.synth';
import {
  SfxCategory,
  synthesizeMusic,
  synthesizeSfx,
  synthesizeVoice,
} from '../../../synth/wav-audio.synth';
import { BaseGeneratorAdapter } from '../../base/base-generator.adapter';
import {
  GeneratorDispatchContext,
  GeneratorOutput,
  GeneratorSubmitResult,
} from '../../generator-adapter.interface';

@Injectable()
export class DemoSynthAdapter extends BaseGeneratorAdapter {
  readonly id = 'demo-synth';
  readonly providerKind = ProviderKind.DEMO;
  readonly modalities: readonly Modality[] = MODALITIES;
  readonly subModes: readonly GenerationSubMode[] = GENERATION_SUB_MODES;
  readonly tier = ExecutionTier.LOCAL;
  override readonly supportsNativeTransparency = true;

  async submit(ctx: GeneratorDispatchContext): Promise<GeneratorSubmitResult> {
    const startedMs = Date.now();
    const rng = mulberry32(ctx.seed);
    const externalJobId = `demo-${ctx.job.id}`;

    const isColdStart = ctx.seed % 3 === 0;
    if (isColdStart) {
      ctx.reportWorker({
        externalJobId,
        externalStatus: 'COLD_START',
        phase: 'COLD_START',
        coldStart: true,
        queueDelayMs: 400,
        workers: {
          idle: 0,
          running: 1,
          initializing: 1,
          throttled: 0,
        },
      });
      await sleep(400, ctx.signal);
    }

    ctx.reportWorker({
      externalJobId,
      externalStatus: 'RUNNING',
      phase: 'RUNNING',
      coldStart: false,
      queueDelayMs: isColdStart ? 400 : 0,
      workers: {
        idle: 1,
        running: 1,
        initializing: 0,
        throttled: 0,
      },
    });

    const totalSimMs = Math.round(650 + rng() * 650);
    const steps = [0, 20, 40, 60, 80, 100];
    const stepDelayMs = Math.max(110, Math.round(totalSimMs / (steps.length - 1)));

    for (let i = 0; i < steps.length - 1; i++) {
      const pct = steps[i]!;
      ctx.reportProgress({
        percent: pct,
        stage: i < 2 ? 'preparing' : 'synthesizing',
        message: `Synthesizing ${ctx.modality} (${pct}%)`,
      });
      await sleep(stepDelayMs, ctx.signal);
    }

    const outputs = await this.generateOutputs(ctx);

    ctx.reportProgress({
      percent: 100,
      stage: 'complete',
      message: 'Synthesis complete (100%)',
    });

    return {
      mode: 'sync',
      outputs,
      costUsd: 0,
      executionMs: Math.max(1, Date.now() - startedMs),
    };
  }

  private async generateOutputs(
    ctx: GeneratorDispatchContext,
  ): Promise<GeneratorOutput[]> {
    const prompt = ctx.compiled.enhancedPrompt;

    switch (ctx.modality) {
      case Modality.ICONS_2D: {
        const iconParams =
          ctx.params.modality === Modality.ICONS_2D ? ctx.params : null;
        const batchCount = Math.max(1, iconParams?.batchCount ?? 1);
        const size = iconParams?.outputSize === 512 ? 512 : 1024;
        const frameShape = iconParams?.frameShape ?? 'NONE';
        const iconCategory = iconParams?.iconCategory ?? 'ITEM';
        const removeBackground = iconParams?.removeBackground ?? true;
        const bgHex = iconParams?.solidBackgroundHex ?? null;

        const outputs: GeneratorOutput[] = [];
        for (let i = 0; i < batchCount; i++) {
          const png = await synthesizeIconPng({
            prompt,
            seed: ctx.seed + i,
            size,
            frameShape,
            iconCategory,
            removeBackground,
            solidBackgroundHex: bgHex,
          });
          outputs.push({
            kind: 'buffer',
            data: png,
            mimeType: 'image/png',
            fileName: `icon_${i + 1}.png`,
            role: AssetFileRole.PRIMARY,
            batchIndex: i,
          });
        }
        return outputs;
      }

      case Modality.IMAGES: {
        const imgParams =
          ctx.params.modality === Modality.IMAGES ? ctx.params : null;
        const batchCount = Math.max(1, imgParams?.batchCount ?? 1);
        const dims = this.sizeFor(ctx.params);
        const tileable =
          imgParams?.aspectPreset === 'SEAMLESS_TILE' ||
          imgParams?.imageCategory === 'PBR_TEXTURE';

        const outputs: GeneratorOutput[] = [];
        for (let i = 0; i < batchCount; i++) {
          const png = await synthesizeArtPng({
            prompt,
            seed: ctx.seed + i,
            width: dims.width,
            height: dims.height,
            tileable,
          });
          outputs.push({
            kind: 'buffer',
            data: png,
            mimeType: 'image/png',
            fileName: `image_${i + 1}.png`,
            role: AssetFileRole.PRIMARY,
            batchIndex: i,
          });
        }
        return outputs;
      }

      case Modality.VIDEO: {
        const vidParams =
          ctx.params.modality === Modality.VIDEO ? ctx.params : null;
        const synth = await synthesizeVideo({
          prompt,
          seed: ctx.seed,
          aspectRatio: vidParams?.aspectRatio ?? '16:9',
          resolution: vidParams?.resolution ?? '1080p',
          durationSec: vidParams?.durationSec ?? 5,
          fps: vidParams?.fps ?? 24,
          videoCategory: vidParams?.videoCategory ?? 'CUTSCENE',
          cameraMotion: vidParams?.cameraMotion ?? 'STATIC',
          motionIntensity: vidParams?.motionIntensity ?? 0.5,
          loopable: vidParams?.loopable ?? false,
          hasAudio: vidParams?.includeAudio ?? false,
          memoryStrategy: vidParams?.memoryStrategy ?? 'RAM_FALLBACK_32GB',
        });

        const outputs: GeneratorOutput[] = [
          {
            kind: 'buffer',
            data: synth.animatedWebp,
            mimeType: 'image/webp',
            fileName: 'video_clip.webp',
            role: AssetFileRole.PRIMARY,
            batchIndex: 0,
            metadata: {
              width: synth.width,
              height: synth.height,
              durationMs: synth.durationMs,
              fps: synth.fps,
              aspectRatio: vidParams?.aspectRatio ?? '16:9',
              videoCategory: vidParams?.videoCategory ?? 'CUTSCENE',
              cameraMotion: vidParams?.cameraMotion ?? 'STATIC',
              loopable: vidParams?.loopable ?? false,
              hasAudio: vidParams?.includeAudio ?? false,
              memoryStrategy: vidParams?.memoryStrategy ?? 'RAM_FALLBACK_32GB',
            },
          },
          {
            kind: 'buffer',
            data: synth.posterPng,
            mimeType: 'image/png',
            fileName: 'poster.png',
            role: AssetFileRole.THUMBNAIL,
            batchIndex: 0,
          },
        ];

        for (let f = 0; f < synth.frames.length; f++) {
          outputs.push({
            kind: 'buffer',
            data: synth.frames[f]!,
            mimeType: 'image/png',
            fileName: `frame_${String(f + 1).padStart(2, '0')}.png`,
            role: AssetFileRole.FRAME,
            batchIndex: 0,
          });
        }

        return outputs;
      }

      case Modality.LORE: {
        const loreParams =
          ctx.params.modality === Modality.LORE ? ctx.params : null;
        const batchCount = Math.max(1, loreParams?.batchCount ?? 1);
        const lengthForm = loreParams?.lengthForm ?? 'SHORT_FORM';
        const loreCategory = loreParams?.loreCategory ?? 'ITEM_DESCRIPTION';
        const tone = loreParams?.tone ?? 'IN_WORLD_DIEGETIC';
        const perspective =
          loreParams?.perspective ?? 'THIRD_PERSON_OMNISCIENT';
        const targetWordCount = loreParams?.targetWordCount ?? 100;
        const includeSections = loreParams?.includeSections ?? false;
        const outputFormat = loreParams?.outputFormat ?? 'MARKDOWN';
        const ext = outputFormat === 'PLAIN_TEXT' ? 'txt' : 'md';
        const mimeType =
          outputFormat === 'PLAIN_TEXT' ? 'text/plain' : 'text/markdown';

        const outputs: GeneratorOutput[] = [];
        for (let i = 0; i < batchCount; i++) {
          const synth = synthesizeLoreText({
            prompt,
            seed: ctx.seed + i,
            lengthForm,
            loreCategory,
            tone,
            perspective,
            targetWordCount,
            includeSections,
            outputFormat,
            projectName: ctx.project.name,
          });
          outputs.push({
            kind: 'text',
            data: synth.text,
            mimeType,
            fileName: `lore_${i + 1}.${ext}`,
            role: AssetFileRole.PRIMARY,
            batchIndex: i,
            metadata: {
              lengthForm,
              loreCategory,
              tone,
              perspective,
              wordCount: synth.wordCount,
              charCount: synth.charCount,
              readingTimeSec: synth.readingTimeSec,
              outputFormat,
              excerpt: synth.excerpt,
            },
          });
        }
        return outputs;
      }

      case Modality.ASSETS_3D: {
        const params3d =
          ctx.params.modality === Modality.ASSETS_3D ? ctx.params : null;
        const category = (params3d?.assetCategory ?? 'PROP') as MeshCategory;
        const pose = (params3d?.pose ?? 'A_POSE') as MeshPose;
        if (
          params3d?.outputFormat &&
          params3d.outputFormat !== 'glb' &&
          !ctx.compiled.warnings.includes(
            'Demo synth only outputs GLB; falling back to .glb',
          )
        ) {
          ctx.compiled.warnings.push(
            'Demo synth only outputs GLB; falling back to .glb',
          );
        }

        const mesh = synthesizeGlbMesh({
          prompt,
          seed: ctx.seed,
          category,
          pose,
        });

        const thumbPng = await synthesizeIconPng({
          prompt,
          seed: ctx.seed,
          size: 512,
          frameShape: 'ROUNDED_SQUARE',
          removeBackground: false,
        });

        return [
          {
            kind: 'buffer',
            data: mesh.glb,
            mimeType: 'model/gltf-binary',
            fileName: 'mesh.glb',
            role: AssetFileRole.PRIMARY,
            batchIndex: 0,
            metadata: {
              vertexCount: mesh.vertexCount,
              triangleCount: mesh.triangleCount,
              boundingBox: mesh.boundingBox,
              hasPbrTextures: params3d?.enablePbr ?? true,
            },
          },
          {
            kind: 'buffer',
            data: thumbPng,
            mimeType: 'image/png',
            fileName: 'thumbnail.png',
            role: AssetFileRole.THUMBNAIL,
            batchIndex: 0,
          },
        ];
      }

      case Modality.MUSIC: {
        const musicParams =
          ctx.params.modality === Modality.MUSIC ? ctx.params : null;
        const durationSec = musicParams?.durationSec ?? 12;
        const bpm =
          musicParams?.bpm ?? this.num(ctx.mergedParams, 'bpm', 100);
        const keySignature =
          musicParams?.keySignature ??
          this.str(ctx.mergedParams, 'key_signature', 'D Dorian');
        const loopable = musicParams?.seamlessLoop ?? true;
        const generateStems = musicParams?.generateStems ?? false;

        const synth = synthesizeMusic({
          seed: ctx.seed,
          durationSec: Math.min(durationSec, 30),
          bpm,
          keySignature,
          seamlessLoop: loopable,
          generateStems,
        });

        const outputs: GeneratorOutput[] = [
          {
            kind: 'buffer',
            data: synth.masterWav,
            mimeType: 'audio/wav',
            fileName: 'music_master.wav',
            role: AssetFileRole.PRIMARY,
            batchIndex: 0,
            metadata: {
              durationMs: synth.durationMs,
              sampleRate: synth.sampleRate,
              bpm: synth.bpm,
              keySignature: synth.keySignature,
              loopable,
            },
          },
        ];

        for (const stem of synth.stems) {
          outputs.push({
            kind: 'buffer',
            data: stem.wav,
            mimeType: 'audio/wav',
            fileName: `stem_${stem.name}.wav`,
            role: AssetFileRole.STEM,
            batchIndex: 0,
          });
        }

        return outputs;
      }

      case Modality.VOICES: {
        const voiceParams =
          ctx.params.modality === Modality.VOICES ? ctx.params : null;
        const speed = voiceParams?.speed ?? 1.0;

        const synth = synthesizeVoice({
          seed: ctx.seed,
          transcript: prompt,
          speed,
          voiceId: ctx.voiceProfile?.externalVoiceId ?? 'alto',
        });

        return [
          {
            kind: 'buffer',
            data: synth.wav,
            mimeType: 'audio/wav',
            fileName: 'voice.wav',
            role: AssetFileRole.PRIMARY,
            batchIndex: 0,
            metadata: {
              durationMs: synth.durationMs,
              sampleRate: synth.sampleRate,
              transcript: prompt,
              alignment: synth.alignment,
            },
          },
        ];
      }

      case Modality.SFX: {
        const sfxParams =
          ctx.params.modality === Modality.SFX ? ctx.params : null;
        const category = (sfxParams?.sfxCategory ??
          'WEAPON_HIT') as SfxCategory;
        const durationSec = sfxParams?.durationSec ?? 2.0;
        const variationCount = Math.max(1, sfxParams?.variationCount ?? 1);
        const loopable = sfxParams?.loopable ?? false;

        const outputs: GeneratorOutput[] = [];
        for (let i = 0; i < variationCount; i++) {
          const synth = synthesizeSfx({
            seed: ctx.seed + i,
            category,
            durationSec,
            loopable,
          });
          outputs.push({
            kind: 'buffer',
            data: synth.wav,
            mimeType: 'audio/wav',
            fileName: `sfx_${i + 1}.wav`,
            role: AssetFileRole.PRIMARY,
            batchIndex: i,
            metadata: {
              durationMs: synth.durationMs,
              sampleRate: synth.sampleRate,
              loopable,
            },
          });
        }
        return outputs;
      }

      case Modality.OTHER:
      default: {
        if (ctx.subMode === GenerationSubMode.SPRITESHEET) {
          const spParams =
            ctx.params.modality === Modality.OTHER
              ? ctx.params.spritesheet
              : null;
          const columns = spParams?.columns ?? 4;
          const frameCount = spParams?.frameCount ?? 8;
          const rawFrameSize = spParams?.frameSize ?? 128;
          const frameSize: 64 | 128 | 256 | 512 =
            rawFrameSize === 64 ||
            rawFrameSize === 128 ||
            rawFrameSize === 256 ||
            rawFrameSize === 512
              ? rawFrameSize
              : 128;

          const sheet = await synthesizeSpritesheetPng({
            prompt,
            seed: ctx.seed,
            columns,
            frameCount,
            frameSize,
          });

          return [
            {
              kind: 'buffer',
              data: sheet.sheetPng,
              mimeType: 'image/png',
              fileName: 'spritesheet.png',
              role: AssetFileRole.PRIMARY,
              batchIndex: 0,
            },
          ];
        }

        if (ctx.subMode === GenerationSubMode.VFX_TEXTURE) {
          const png = await synthesizeArtPng({
            prompt,
            seed: ctx.seed,
            width: 1024,
            height: 1024,
            grayscale: true,
            tileable: true,
          });
          return [
            {
              kind: 'buffer',
              data: png,
              mimeType: 'image/png',
              fileName: 'vfx_texture.png',
              role: AssetFileRole.PRIMARY,
              batchIndex: 0,
            },
          ];
        }

        if (ctx.subMode === GenerationSubMode.SHADER_CODE) {
          const shParams =
            ctx.params.modality === Modality.OTHER ? ctx.params.shader : null;
          const language = shParams?.language ?? 'GLSL';
          const targetEngine = shParams?.targetEngine ?? 'GENERIC';

          const synth = synthesizeShaderCode({
            prompt,
            seed: ctx.seed,
            language,
            targetEngine,
          });

          return [
            {
              kind: 'text',
              data: synth.code,
              mimeType: 'text/plain',
              fileName: `shader.${synth.extension}`,
              role: AssetFileRole.PRIMARY,
              batchIndex: 0,
              metadata: {
                language,
                lineCount: synth.lineCount,
              },
            },
          ];
        }

        // LORE_JSON
        const loreParams =
          ctx.params.modality === Modality.OTHER ? ctx.params.loreJson : null;
        const rawSchemaKind = loreParams?.schemaKind ?? 'ITEM_TABLE';
        const schemaKind:
          | 'ITEM_TABLE'
          | 'DIALOGUE_TREE'
          | 'QUEST'
          | 'NPC_ROSTER' =
          rawSchemaKind === 'DIALOGUE_TREE' ||
          rawSchemaKind === 'QUEST' ||
          rawSchemaKind === 'NPC_ROSTER'
            ? rawSchemaKind
            : 'ITEM_TABLE';
        const entryCount = loreParams?.entryCount ?? 5;

        const synth = synthesizeLoreJson({
          prompt,
          seed: ctx.seed,
          schemaKind,
          entryCount,
          projectSlug: ctx.project.slug,
        });

        return [
          {
            kind: 'text',
            data: synth.jsonText,
            mimeType: 'application/json',
            fileName: 'lore.json',
            role: AssetFileRole.PRIMARY,
            batchIndex: 0,
            metadata: {
              schemaKind: rawSchemaKind,
              lineCount: synth.lineCount,
            },
          },
        ];
      }
    }
  }
}
