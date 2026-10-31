import {
  Assets3DParamsSchema,
  CreateJobSchema,
  defaultParamsFor,
  LoreParamsSchema,
  MODALITIES,
  ModalityParamsSchema,
  UpsertProviderSchema,
  VideoParamsSchema,
} from '../src';

describe('modality-params & job/provider schemas', () => {
  it('builds valid default params for all 9 modalities', () => {
    expect(MODALITIES.length).toBe(9);
    for (const m of MODALITIES) {
      const def = defaultParamsFor(m);
      expect(def.modality).toBe(m);
      const parsed = ModalityParamsSchema.safeParse(def);
      expect(parsed.success).toBe(true);
    }
  });

  it('validates VideoParamsSchema and enforces IMAGE_TO_VIDEO referenceStorageKey in CreateJobSchema', () => {
    const defVideo = defaultParamsFor('VIDEO');
    expect(defVideo.memoryStrategy).toBe('RAM_FALLBACK_32GB');
    expect(defVideo.fps).toBe(24);

    const directFail = VideoParamsSchema.safeParse({
      modality: 'VIDEO',
      subMode: 'IMAGE_TO_VIDEO',
      referenceStorageKey: null,
    });
    expect(directFail.success).toBe(false);

    const jobFail = CreateJobSchema.safeParse({
      projectId: 'proj_1',
      executionMode: 'AUTO_FIRE',
      rawPrompt: 'Camera pan across Aethelgard spire',
      providerConfigId: 'prov_1',
      params: {
        modality: 'VIDEO',
        subMode: 'IMAGE_TO_VIDEO',
        referenceStorageKey: null,
      },
    });
    expect(jobFail.success).toBe(false);
    if (!jobFail.success) {
      expect(jobFail.error.issues[0]?.path).toEqual(['params', 'referenceStorageKey']);
    }
  });

  it('validates LoreParamsSchema for both SHORT_FORM item descriptions and LONG_FORM character backstories', () => {
    const shortLore = LoreParamsSchema.parse({
      modality: 'LORE',
      lengthForm: 'SHORT_FORM',
      loreCategory: 'ITEM_DESCRIPTION',
      targetWordCount: 80,
    });
    expect(shortLore.lengthForm).toBe('SHORT_FORM');
    expect(shortLore.loreCategory).toBe('ITEM_DESCRIPTION');

    const longLore = LoreParamsSchema.parse({
      modality: 'LORE',
      lengthForm: 'LONG_FORM',
      loreCategory: 'CHARACTER_BACKSTORY',
      tone: 'POETIC_MYTHIC',
      targetWordCount: 1500,
      includeSections: true,
    });
    expect(longLore.lengthForm).toBe('LONG_FORM');
    expect(longLore.targetWordCount).toBe(1500);
    expect(longLore.includeSections).toBe(true);
  });

  it('enforces IMAGE_TO_3D referenceStorageKey requirement in Assets3DParamsSchema and CreateJobSchema', () => {
    const directFail = Assets3DParamsSchema.safeParse({
      modality: 'ASSETS_3D',
      subMode: 'IMAGE_TO_3D',
      referenceStorageKey: null,
    });
    expect(directFail.success).toBe(false);

    const jobFail = CreateJobSchema.safeParse({
      projectId: 'proj_1',
      executionMode: 'AUTO_FIRE',
      rawPrompt: '3d sword',
      providerConfigId: 'prov_1',
      params: {
        modality: 'ASSETS_3D',
        subMode: 'IMAGE_TO_3D',
        referenceStorageKey: null,
      },
    });
    expect(jobFail.success).toBe(false);
    if (!jobFail.success) {
      expect(jobFail.error.issues[0]?.path).toEqual(['params', 'referenceStorageKey']);
    }
  });

  it('enforces non-empty transcript for VOICES in CreateJobSchema', () => {
    const voiceFail = CreateJobSchema.safeParse({
      projectId: 'proj_1',
      executionMode: 'AUTO_FIRE',
      rawPrompt: 'Speak with urgency',
      providerConfigId: 'prov_1',
      params: {
        modality: 'VOICES',
        transcript: '   ',
      },
    });
    expect(voiceFail.success).toBe(false);

    const voiceOk = CreateJobSchema.safeParse({
      projectId: 'proj_1',
      executionMode: 'AUTO_FIRE',
      rawPrompt: 'Speak with urgency',
      providerConfigId: 'prov_1',
      params: {
        modality: 'VOICES',
        transcript: 'Every star remembers.',
      },
    });
    expect(voiceOk.success).toBe(true);
  });

  it('accepts advanced ParamSpec overrides on CreateJobSchema', () => {
    const parsed = CreateJobSchema.parse({
      projectId: 'proj_1',
      executionMode: 'INTERCEPT',
      rawPrompt: 'Celestial potion icon',
      providerConfigId: 'prov_1',
      params: { modality: 'ICONS_2D' },
      advanced: { steps: 35, guidance_scale: 4.5, high_noise: false, sampler: 'euler' },
    });
    expect(parsed.advanced).toEqual({
      steps: 35,
      guidance_scale: 4.5,
      high_noise: false,
      sampler: 'euler',
    });
  });

  it('validates OTHER subModes and nested default objects', () => {
    const parsed = ModalityParamsSchema.parse({
      modality: 'OTHER',
      subMode: 'SPRITESHEET',
    });
    expect(parsed.modality).toBe('OTHER');
    if (parsed.modality === 'OTHER') {
      expect(parsed.spritesheet.frameCount).toBe(16);
      expect(parsed.spritesheet.columns).toBe(4);
      expect(parsed.spritesheet.frameSize).toBe(256);
    }
  });

  it('enforces UpsertProviderSchema superRefine rules for RUNPOD_SERVERLESS and COMFYUI', () => {
    const runpodInvalid = UpsertProviderSchema.safeParse({
      name: 'RunPod Flux',
      kind: 'RUNPOD_SERVERLESS',
      tier: 'RUNPOD',
      roles: ['GENERATOR'],
      modalities: ['IMAGES'],
    });
    expect(runpodInvalid.success).toBe(false);
    if (!runpodInvalid.success) {
      const paths = runpodInvalid.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('runpodEndpointId');
      expect(paths).toContain('payloadTemplate');
      expect(paths).toContain('outputMapping');
    }

    const comfyInvalid = UpsertProviderSchema.safeParse({
      name: 'Local Comfy',
      kind: 'COMFYUI',
      tier: 'LOCAL',
      roles: ['GENERATOR'],
      modalities: ['IMAGES'],
    });
    expect(comfyInvalid.success).toBe(false);
    if (!comfyInvalid.success) {
      const paths = comfyInvalid.error.issues.map((i) => i.path[0]);
      expect(paths).toContain('workflowTemplate');
      expect(paths).toContain('baseUrl');
    }
  });
});
