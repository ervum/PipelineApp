import {
  AdapterDescriptor,
  ExecutionTier,
  GenerationSubMode,
  MODALITY_META,
  Modality,
  ModalityParams,
  POLYCOUNT_TARGETS,
  ProviderKind,
  stripMentions,
} from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { ContextBlock } from './context-assembler.service';

export interface SystemPromptBuildInput {
  template: {
    name: string;
    systemTemplate: string;
    defaultNegativePrompt: string;
    hardConstraints: string;
  };
  descriptor: AdapterDescriptor;
  modality: Modality;
  params: ModalityParams;
  project: {
    name: string;
    genre: string;
  };
  provider?: {
    kind: ProviderKind;
    model?: string | null;
    tier: ExecutionTier;
  };
  supportsNativeTransparency?: boolean;
  referenceImageAttached?: boolean;
}

export interface UserMessageBuildInput {
  globalSummary: string;
  blocks: ContextBlock[];
  rawPrompt: string;
  params: ModalityParams;
  voiceProfile?: {
    name: string;
    description: string;
  } | null;
}

@Injectable()
export class SystemPromptBuilder {
  build(input: SystemPromptBuildInput): string {
    const modalityLabel = MODALITY_META[input.modality]?.label ?? input.modality;
    const providerKind = input.provider?.kind ?? input.descriptor.providerKind;
    const model = input.provider?.model ?? 'default';
    const tier = input.provider?.tier ?? ExecutionTier.LOCAL;
    const supportsNeg = input.descriptor.supportsNegativePrompt;
    const supportsSeed = input.descriptor.supportsSeed;
    const refAttached = Boolean(input.referenceImageAttached);

    const negRuleSuffix = !supportsNeg
      ? ' The target\n   does not accept negative prompts: still fill negativePrompt; the system will fold it in.'
      : '';

    const roleSection = [
      '# ROLE',
      `You are the ForgeStudio Middleman Prompt Compiler for the game project "${input.project.name}" (${input.project.genre}).`,
      `You transform a short creative request into a production-ready generation payload for a specific`,
      `${modalityLabel} generator, strictly obeying the project's vault context.`,
    ].join('\n');

    const compilerRulesSection = [
      '# COMPILER RULES',
      '1. The vault context is authoritative. When it specifies colours (hex), proportions, materials,',
      '   naming, tone or audio direction, encode them explicitly in enhancedPrompt.',
      '2. Never invent lore that contradicts the vault. If the request conflicts with the vault, follow the',
      '   vault and add a warning.',
      '3. Write enhancedPrompt in the style the target generator responds to best (see TARGET GENERATOR).',
      `4. Keep enhancedPrompt ≤ ${input.descriptor.maxPromptChars} characters.`,
      `5. negativePrompt lists concrete exclusions, comma-separated.${negRuleSuffix}`,
      '6. recommendedParams may ONLY use keys from ALLOWED PARAMETERS, within their ranges.',
      '7. contextSourcesUsed lists every vault_file id that materially influenced the output, each with a',
      '   reasoningNote ≤ 200 chars. Never list ids that were not provided.',
      "8. assetTitle is a short in-world display name following the project's naming conventions.",
      '9. Output ONLY the JSON object described in OUTPUT CONTRACT. No markdown fences, no commentary.',
    ].join('\n');

    const blueprintSection = [
      '# MODALITY SYSTEM BLUEPRINT',
      input.template.systemTemplate.trim(),
    ].join('\n');

    const templateConstraints = input.template.hardConstraints
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => (line.startsWith('- ') ? line : `- ${line}`));

    const autoConstraints = this.buildAutoConstraints(
      input.modality,
      input.params,
      Boolean(input.supportsNativeTransparency),
    ).map((c) => `- ${c}`);

    const hardConstraintsSection = [
      '# HARD CONSTRAINTS',
      ...[...templateConstraints, ...autoConstraints],
    ].join('\n');

    const targetGeneratorSection = [
      '# TARGET GENERATOR',
      `Provider: ${providerKind} · Model: ${model} · Tier: ${tier}`,
      `Supports negative prompt: ${supportsNeg ? 'yes' : 'no'} · Supports seed: ${supportsSeed ? 'yes' : 'no'} · Reference image attached: ${refAttached ? 'yes' : 'no'}`,
    ].join('\n');

    const allowedParamLines = input.descriptor.paramSpecs.map((spec) => {
      let rangeOrOptions = '';
      if (spec.min !== undefined || spec.max !== undefined) {
        rangeOrOptions = `, ${spec.min ?? ''}-${spec.max ?? ''}`;
      } else if (spec.options && spec.options.length > 0) {
        rangeOrOptions = `, ${spec.options.map((o) => o.value).join('|')}`;
      }
      return `- ${spec.key} (${spec.type}${rangeOrOptions}) default=${String(spec.default)}: ${spec.description}`;
    });

    const allowedParametersSection = [
      '# ALLOWED PARAMETERS',
      ...(allowedParamLines.length > 0 ? allowedParamLines : ['- (none)']),
    ].join('\n');

    const defaultNegativeSection = [
      '# DEFAULT NEGATIVE PROMPT (merge, do not drop)',
      input.template.defaultNegativePrompt.trim() || '(none)',
    ].join('\n');

    const outputContractSection = [
      '# OUTPUT CONTRACT',
      '{"assetTitle": string, "enhancedPrompt": string, "negativePrompt": string,',
      ' "recommendedParams": { [key]: string|number|boolean|null|string[] },',
      ' "contextSourcesUsed": [{"fileId": string, "fileName": string, "reasoningNote": string}],',
      ' "warnings": string[]}',
    ].join('\n');

    return [
      roleSection,
      compilerRulesSection,
      blueprintSection,
      hardConstraintsSection,
      targetGeneratorSection,
      allowedParametersSection,
      defaultNegativeSection,
      outputContractSection,
    ].join('\n\n');
  }

  buildUserMessage(input: UserMessageBuildInput): string {
    const parts: string[] = [];

    parts.push(`<project_summary>\n${input.globalSummary.trim()}\n</project_summary>`);

    for (const block of input.blocks) {
      parts.push(block.envelopeXml);
    }

    const strippedPrompt = stripMentions(input.rawPrompt) || input.rawPrompt.trim();
    parts.push(`<user_request>${strippedPrompt}</user_request>`);
    parts.push(`<user_params>${JSON.stringify(input.params, null, 2)}</user_params>`);

    if (input.params.modality === 'VOICES') {
      parts.push(`<transcript>${input.params.transcript}</transcript>`);
    }

    if (input.voiceProfile) {
      parts.push(
        `<voice_profile name="${input.voiceProfile.name}">${input.voiceProfile.description}</voice_profile>`,
      );
    }

    return parts.join('\n\n');
  }

  /**
   * Auto constraints derived from modality & params (§4.6.3 table).
   */
  public buildAutoConstraints(
    modality: Modality,
    params: ModalityParams,
    supportsNativeTransparency: boolean,
  ): string[] {
    const constraints: string[] = [];

    if (modality === Modality.ICONS_2D && params.modality === 'ICONS_2D') {
      constraints.push(
        'Single centered subject, die-cut silhouette, occupies 70–80% of frame, readable at 64x64 and 32x32, no text, no border unless frameShape ≠ NONE.',
      );
      if (params.removeBackground && !supportsNativeTransparency) {
        constraints.push(
          'Render on a perfectly flat pure #00FF00 background with no shadows touching the edges and no green in the subject.',
        );
      } else if (params.removeBackground && supportsNativeTransparency) {
        constraints.push('Transparent background (alpha).');
      }
      if (params.frameShape !== 'NONE') {
        constraints.push(
          `Enclose the subject in a ${params.frameShape} frame consistent with the project's UI style.`,
        );
      }
      return constraints;
    }

    if (modality === Modality.ASSETS_3D && params.modality === 'ASSETS_3D') {
      const target = POLYCOUNT_TARGETS[params.polycountTier] ?? POLYCOUNT_TARGETS.MID_POLY;
      constraints.push(
        `Single isolated object, no floor plane, no environment, neutral lighting, clean readable silhouette, ${params.polycountTier} game-ready topology (~${target} triangles), PBR materials: describe base colour, roughness, metalness.`,
      );
      if (params.pose !== 'NONE') {
        const poseLabel = params.pose === 'T_POSE' ? 'T-pose' : 'A-pose';
        constraints.push(`Character in a strict ${poseLabel}, symmetrical, arms clear of torso.`);
      }
      return constraints;
    }

    if (modality === Modality.IMAGES && params.modality === 'IMAGES') {
      if (params.aspectPreset === 'SEAMLESS_TILE') {
        constraints.push(
          'Seamlessly tileable texture, no vignette, no perspective, uniform lighting, edges must wrap.',
        );
      }
      if (params.imageCategory === 'PBR_TEXTURE') {
        constraints.push('Flat albedo texture, no baked shadows or highlights.');
      }
      return constraints;
    }

    if (modality === Modality.VIDEO && params.modality === 'VIDEO') {
      constraints.push(
        `Describe temporal choreography, subject motion, camera trajectory (${params.cameraMotion}, intensity ${Math.round(params.motionIntensity * 100)}%), lighting continuity, and ${params.aspectRatio} composition over ${params.durationSec}s at ${params.fps}fps.`,
      );
      if (params.loopable) {
        constraints.push(
          'First and final frames must match in framing and lighting for a seamless video loop.',
        );
      }
      if (params.memoryStrategy === 'RAM_FALLBACK_32GB' || params.memoryStrategy === 'LOW_VRAM_TILED') {
        constraints.push(
          `Hardware hint: keep temporal scene complexity coherent for ${params.memoryStrategy} (32GB DDR5 system RAM fallback active).`,
        );
      }
      return constraints;
    }

    if (modality === Modality.LORE && params.modality === 'LORE') {
      constraints.push(
        `enhancedPrompt is a detailed literary brief for ${params.lengthForm} narrative (${params.loreCategory}), written in ${params.tone} tone from a ${params.perspective} perspective, targeting ~${params.targetWordCount} words in ${params.outputFormat} format.`,
      );
      if (params.includeSections) {
        constraints.push(
          'Require structured headings, an opening in-world epigraph quote, and key narrative/gameplay hooks.',
        );
      }
      return constraints;
    }

    if (modality === Modality.MUSIC && params.modality === 'MUSIC') {
      const musicParts = [
        `Specify BPM, key, instrumentation, structure with timestamps; duration ${params.durationSec}s.`,
      ];
      if (params.seamlessLoop) {
        musicParts.push('ending must resolve into the opening bar for a seamless loop.');
      }
      if (params.instrumentalOnly) {
        musicParts.push('no vocals.');
      }
      constraints.push(musicParts.join(' '));
      return constraints;
    }

    if (modality === Modality.VOICES && params.modality === 'VOICES') {
      constraints.push(
        'enhancedPrompt is the exact text to be spoken: preserve the transcript wording; only add delivery tags supported by the provider. Put acting direction in recommendedParams.instructions.',
      );
      return constraints;
    }

    if (modality === Modality.SFX && params.modality === 'SFX') {
      constraints.push(
        `Describe the physical sound source, material, attack/decay, duration ${params.durationSec}s${params.loopable ? ', seamlessly loopable' : ''}. No music, no voices.`,
      );
      return constraints;
    }

    if (modality === Modality.OTHER && params.modality === 'OTHER') {
      if (params.subMode === GenerationSubMode.SPRITESHEET) {
        const columns = params.spritesheet.columns;
        const frameCount = params.spritesheet.frameCount;
        const rows = Math.max(1, Math.ceil(frameCount / Math.max(1, columns)));
        constraints.push(
          `A ${columns}x${rows} grid of ${frameCount} evenly spaced animation frames of the same subject, identical scale and position, flat background.`,
        );
      } else if (params.subMode === GenerationSubMode.VFX_TEXTURE) {
        constraints.push(
          `${params.vfx.grayscale ? 'Grayscale' : 'Colour'} ${params.vfx.textureType} texture on pure black, centered, soft falloff${params.vfx.tileable ? ', tileable' : ''}.`,
        );
      } else if (params.subMode === GenerationSubMode.SHADER_CODE) {
        constraints.push(
          `enhancedPrompt is a precise engineering spec for ${params.shader.language} targeting ${params.shader.targetEngine}.`,
        );
      } else if (params.subMode === GenerationSubMode.LORE_JSON) {
        constraints.push(
          `enhancedPrompt is a precise spec for ${params.loreJson.entryCount} ${params.loreJson.schemaKind} entries; include the exact JSON schema.`,
        );
      }
      return constraints;
    }

    return constraints;
  }
}
