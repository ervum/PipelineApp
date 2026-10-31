import {
  defaultParamsFor,
  ExecutionTier,
  GenerationSubMode,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { SEED_MIDDLEMAN_TEMPLATES } from '../prisma/seed/content/middleman-templates';
import { SystemPromptBuilder } from '../src/middleman/system-prompt.builder';
import { buildFallbackAdapterDescriptor } from '../src/providers/providers.service';

describe('SystemPromptBuilder (7 modalities with seeded templates)', () => {
  const builder = new SystemPromptBuilder();
  const project = {
    name: 'Astra Dream — 2D/3D Action RPG',
    genre: 'Stylized Astral Fantasy Action RPG (Roblox / Godot)',
  };

  const allModalities: Modality[] = [
    Modality.ICONS_2D,
    Modality.ASSETS_3D,
    Modality.IMAGES,
    Modality.MUSIC,
    Modality.VOICES,
    Modality.SFX,
    Modality.OTHER,
  ];

  it.each(allModalities)(
    'builds complete deterministic system prompt for modality %s with all required sections',
    (modality) => {
      const template = SEED_MIDDLEMAN_TEMPLATES.find((t) => t.modality === modality);
      expect(template).toBeDefined();

      const params = defaultParamsFor(modality);
      const subMode =
        'subMode' in params ? (params.subMode as GenerationSubMode) : GenerationSubMode.STANDARD;
      const descriptor = buildFallbackAdapterDescriptor(ProviderKind.DEMO, modality, subMode);

      const prompt = builder.build({
        template: template!,
        descriptor,
        modality,
        params,
        project,
        provider: {
          kind: ProviderKind.DEMO,
          model: 'forge-demo-synth-1',
          tier: ExecutionTier.LOCAL,
        },
        supportsNativeTransparency: false,
        referenceImageAttached: false,
      });

      expect(prompt).toContain('# ROLE');
      expect(prompt).toContain('# COMPILER RULES');
      expect(prompt).toContain('# MODALITY SYSTEM BLUEPRINT');
      expect(prompt).toContain(template!.systemTemplate.trim());
      expect(prompt).toContain('# HARD CONSTRAINTS');
      expect(prompt).toContain('# TARGET GENERATOR');
      expect(prompt).toContain('# ALLOWED PARAMETERS');
      expect(prompt).toContain('# DEFAULT NEGATIVE PROMPT (merge, do not drop)');
      expect(prompt).toContain('# OUTPUT CONTRACT');
      expect(prompt).toMatchSnapshot();
    },
  );

  it('injects #00FF00 chroma-key constraint for ICONS_2D when removeBackground=true and !supportsNativeTransparency', () => {
    const template = SEED_MIDDLEMAN_TEMPLATES.find((t) => t.modality === Modality.ICONS_2D)!;
    const params = {
      ...defaultParamsFor(Modality.ICONS_2D),
      removeBackground: true,
      frameShape: 'HEXAGON' as const,
    };
    const descriptor = buildFallbackAdapterDescriptor(
      ProviderKind.FAL,
      Modality.ICONS_2D,
      GenerationSubMode.STANDARD,
    );

    const prompt = builder.build({
      template,
      descriptor,
      modality: Modality.ICONS_2D,
      params,
      project,
      supportsNativeTransparency: false,
    });

    expect(prompt).toContain('Render on a perfectly flat pure #00FF00 background');
    expect(prompt).toContain("Enclose the subject in a HEXAGON frame consistent with the project's UI style.");
  });

  it('injects polycount target and T-pose constraint for ASSETS_3D', () => {
    const template = SEED_MIDDLEMAN_TEMPLATES.find((t) => t.modality === Modality.ASSETS_3D)!;
    const params = {
      ...defaultParamsFor(Modality.ASSETS_3D),
      polycountTier: 'MID_POLY' as const,
      pose: 'T_POSE' as const,
    };
    const descriptor = buildFallbackAdapterDescriptor(
      ProviderKind.MESHY,
      Modality.ASSETS_3D,
      GenerationSubMode.TEXT_TO_3D,
    );

    const prompt = builder.build({
      template,
      descriptor,
      modality: Modality.ASSETS_3D,
      params,
      project,
    });

    expect(prompt).toContain('MID_POLY game-ready topology (~30000 triangles)');
    expect(prompt).toContain('Character in a strict T-pose, symmetrical, arms clear of torso.');
  });

  it('formats user message with project_summary, vault_file blocks, stripped @mentions in user_request, user_params, transcript, and voice_profile', () => {
    const params = {
      ...defaultParamsFor(Modality.VOICES),
      transcript: 'Stand back! The Rift Gate is destabilizing!',
    };
    const userMessage = builder.buildUserMessage({
      globalSummary: 'Stylized astral action RPG.',
      blocks: [
        {
          fileId: 'vf_1',
          fileName: 'Voice Direction.md',
          folderPath: '/Audio & Music',
          reason: 'PINNED',
          truncated: false,
          tokens: 45,
          envelopeXml:
            '<vault_file id="vf_1" name="Voice Direction.md" folder="/Audio & Music" scopes="VOICES" reason="PINNED" truncated="false">\nKeep barks punchy.\n</vault_file>',
        },
      ],
      rawPrompt: 'Urgent combat warning @voice-direction.md',
      params,
      voiceProfile: {
        name: 'Lyra — Astral Ranger (Player)',
        description: 'Warm alto, agile and resolute.',
      },
    });

    expect(userMessage).toContain('<project_summary>\nStylized astral action RPG.\n</project_summary>');
    expect(userMessage).toContain('<vault_file id="vf_1"');
    expect(userMessage).toContain('<user_request>Urgent combat warning voice-direction.md</user_request>');
    expect(userMessage).toContain('<transcript>Stand back! The Rift Gate is destabilizing!</transcript>');
    expect(userMessage).toContain(
      '<voice_profile name="Lyra — Astral Ranger (Player)">Warm alto, agile and resolute.</voice_profile>',
    );
  });
});
