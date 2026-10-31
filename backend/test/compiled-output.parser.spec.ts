import {
  AdapterDescriptor,
  GenerationSubMode,
  Modality,
  ProviderKind,
} from '@forge/shared';
import { DomainError } from '../src/common/errors/domain.error';
import {
  CompiledOutputParser,
  CompileParseContext,
} from '../src/middleman/compiled-output.parser';

describe('CompiledOutputParser', () => {
  const parser = new CompiledOutputParser();

  const baseDescriptor: AdapterDescriptor = {
    adapterId: 'fal-image',
    providerKind: ProviderKind.FAL,
    modality: Modality.ICONS_2D,
    subModes: [GenerationSubMode.STANDARD],
    supportsNegativePrompt: true,
    supportsSeed: true,
    supportsReferenceImage: true,
    supportsBatch: true,
    maxPromptChars: 120,
    paramSpecs: [
      {
        key: 'guidance_scale',
        label: 'Guidance Scale',
        type: 'number',
        min: 1,
        max: 20,
        step: 0.5,
        default: 7.5,
        description: 'CFG scale',
        advanced: false,
      },
      {
        key: 'steps',
        label: 'Steps',
        type: 'integer',
        min: 10,
        max: 50,
        step: 1,
        default: 28,
        description: 'Sampling steps',
        advanced: true,
      },
      {
        key: 'quality',
        label: 'Quality',
        type: 'enum',
        options: [
          { value: 'standard', label: 'Standard' },
          { value: 'hd', label: 'HD' },
        ],
        default: 'hd',
        description: 'Render quality',
        advanced: false,
      },
      {
        key: 'transparent',
        label: 'Transparent',
        type: 'boolean',
        default: true,
        description: 'Alpha channel',
        advanced: false,
      },
    ],
  };

  const baseCtx: CompileParseContext = {
    availableFiles: [
      { id: 'file_palette', name: 'Color Palette.md' },
      { id: 'file_icons', name: 'Icon Style Guide.md' },
    ],
    descriptor: baseDescriptor,
    defaultNegativePrompt: 'blurry, watermark, text, noisy background',
  };

  it('parses markdown-fenced JSON output cleanly', () => {
    const raw = [
      '```json',
      JSON.stringify({
        assetTitle: 'Solaris Flame Katana',
        enhancedPrompt: 'Centered die-cut RPG katana icon with #F5C451 gold hilt',
        negativePrompt: 'lowres, cropped',
        recommendedParams: { guidance_scale: 8.5, steps: 30, quality: 'hd' },
        contextSourcesUsed: [
          {
            fileId: 'file_palette',
            fileName: 'Color Palette.md',
            reasoningNote: 'Applied #F5C451 solar gold accent',
          },
        ],
        warnings: [],
      }),
      '```',
    ].join('\n');

    const result = parser.parse(raw, baseCtx);
    expect(result.assetTitle).toBe('Solaris Flame Katana');
    expect(result.recommendedParams).toEqual({
      guidance_scale: 8.5,
      steps: 30,
      quality: 'hd',
    });
    expect(result.contextSourcesUsed).toHaveLength(1);
    expect(result.contextSourcesUsed[0]?.fileId).toBe('file_palette');
  });

  it('extracts JSON wrapped in prose and handles braces inside string literals', () => {
    const raw = `Here is the compiled prompt payload you requested:\n${JSON.stringify({
      assetTitle: 'Void Shard {Tier 3}',
      enhancedPrompt: 'Dark crystalline shard with inner {violet} #7C3AED glow',
      negativePrompt: 'blurry',
      recommendedParams: { guidance_scale: 7.5 },
      contextSourcesUsed: [],
      warnings: [],
    })}\nLet me know if you need adjustments!`;

    const result = parser.parse(raw, baseCtx);
    expect(result.assetTitle).toBe('Void Shard {Tier 3}');
    expect(result.enhancedPrompt).toContain('{violet} #7C3AED');
  });

  it('repairs trailing commas and smart quotes via lightRepairJson', () => {
    const rawWithTrailingCommas = `{
      “assetTitle”: “Aether Compass”,
      "enhancedPrompt": "Ornate brass compass icon, centered silhouette",
      "negativePrompt": "text, watermark,",
      "recommendedParams": {
        "guidance_scale": 9.0,
        "steps": 25,
      },
      "contextSourcesUsed": [
        { "fileId": "file_icons", "fileName": "Wrong Name.md", "reasoningNote": "Silhouette rule", },
      ],
      "warnings": [],
    }`;

    const result = parser.parse(rawWithTrailingCommas, baseCtx);
    expect(result.assetTitle).toBe('Aether Compass');
    expect(result.contextSourcesUsed[0]?.fileName).toBe('Icon Style Guide.md');
  });

  it('drops unknown context fileIds with a warning and overwrites mismatched fileName', () => {
    const raw = JSON.stringify({
      assetTitle: 'Relic Shield',
      enhancedPrompt: 'Centered shield icon with obsidian rim',
      negativePrompt: '',
      recommendedParams: {},
      contextSourcesUsed: [
        {
          fileId: 'file_palette',
          fileName: 'Hallucinated Filename.md',
          reasoningNote: 'Used primary hex',
        },
        {
          fileId: 'file_nonexistent_999',
          fileName: 'Ghost File.md',
          reasoningNote: 'Hallucinated source',
        },
      ],
      warnings: [],
    });

    const result = parser.parse(raw, baseCtx);
    expect(result.contextSourcesUsed).toEqual([
      {
        fileId: 'file_palette',
        fileName: 'Color Palette.md',
        reasoningNote: 'Used primary hex',
      },
    ]);
    expect(result.warnings.some((w) => w.includes('file_nonexistent_999'))).toBe(true);
  });

  it('clamps numeric params, rounds integer params, coerces boolean strings, and drops invalid enums with warnings', () => {
    const raw = JSON.stringify({
      assetTitle: 'Rune Stone',
      enhancedPrompt: 'Glowing cyan rune stone icon',
      negativePrompt: '',
      recommendedParams: {
        guidance_scale: 45, // max is 20 -> clamp to 20
        steps: 14.7, // integer -> round to 15
        quality: 'ultra_8k_invalid', // invalid enum -> drop with warning
        transparent: 'true', // string boolean -> coerce to true
        unknown_vendor_flag: 123, // unknown key -> drop with warning
      },
      contextSourcesUsed: [],
      warnings: [],
    });

    const result = parser.parse(raw, baseCtx);
    expect(result.recommendedParams).toEqual({
      guidance_scale: 20,
      steps: 15,
      transparent: true,
    });
    expect(result.warnings.some((w) => w.includes('guidance_scale'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('quality'))).toBe(true);
    expect(result.warnings.some((w) => w.includes('unknown_vendor_flag'))).toBe(true);
  });

  it('merges template defaultNegativePrompt terms with case-insensitive deduplication', () => {
    const raw = JSON.stringify({
      assetTitle: 'Frost Dagger',
      enhancedPrompt: 'Crystalline frost dagger icon',
      negativePrompt: 'Watermark, extra limbs, BLURRY, jpeg artifacts',
      recommendedParams: {},
      contextSourcesUsed: [],
      warnings: [],
    });

    const result = parser.parse(raw, baseCtx);
    const terms = result.negativePrompt.split(',').map((t) => t.trim().toLowerCase());
    expect(terms).toEqual([
      'watermark',
      'extra limbs',
      'blurry',
      'jpeg artifacts',
      'text',
      'noisy background',
    ]);
  });

  it('truncates enhancedPrompt to descriptor.maxPromptChars at a word boundary and adds a warning', () => {
    const longPrompt =
      'Single centered die-cut legendary astral broadsword icon with #7C3AED nebula core, #F5C451 filigree crossguard, dramatic rim lighting, and crisp dark silhouette readable at 32x32';
    expect(longPrompt.length).toBeGreaterThan(baseDescriptor.maxPromptChars);

    const raw = JSON.stringify({
      assetTitle: 'Astral Broadsword',
      enhancedPrompt: longPrompt,
      negativePrompt: '',
      recommendedParams: {},
      contextSourcesUsed: [],
      warnings: [],
    });

    const result = parser.parse(raw, baseCtx);
    expect(result.enhancedPrompt.length).toBeLessThanOrEqual(baseDescriptor.maxPromptChars);
    expect(result.warnings.some((w) => w.includes('Truncated enhancedPrompt'))).toBe(true);
  });

  it('throws DomainError(MIDDLEMAN_PARSE_FAILED) when no JSON object exists', () => {
    expect(() => parser.parse('I cannot fulfill this request.', baseCtx)).toThrow(DomainError);
  });
});
