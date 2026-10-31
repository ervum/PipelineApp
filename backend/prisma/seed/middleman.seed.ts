import { MiddlemanProfile, MiddlemanTemplate, Modality } from '@prisma/client';
import { SEED_MIDDLEMAN_TEMPLATES } from './content/middleman-templates';
import { SeededProvidersMap } from './providers.seed';
import { SeedContext } from './seed-context';

export interface SeededMiddlemanData {
  profilesByName: Record<string, MiddlemanProfile>;
  defaultProfile: MiddlemanProfile;
  templatesByModality: Record<Modality, MiddlemanTemplate>;
}

export async function seedMiddleman(
  ctx: SeedContext,
  providers: SeededProvidersMap,
): Promise<SeededMiddlemanData> {
  const hasAnthropicKey = Boolean(process.env['SEED_ANTHROPIC_API_KEY']?.trim());
  const hasGeminiKey = Boolean(process.env['SEED_GEMINI_API_KEY']?.trim());

  const profileDefs = [
    {
      name: 'Demo Compiler (offline)',
      providerConfigId: providers.demo.id,
      model: 'forge-demo-compiler-1',
      temperature: 0.0,
      maxOutputTokens: 1600,
      maxContextTokens: 12000,
      supportsVision: true,
      attachReferenceImages: true,
      maxReferenceImages: 3,
      jsonMode: true,
      isDefault: !hasAnthropicKey,
      isVisionDefault: !hasGeminiKey,
    },
    {
      name: 'Claude Sonnet Compiler',
      providerConfigId: providers.anthropic.id,
      model: 'claude-sonnet-4-5',
      temperature: 0.4,
      maxOutputTokens: 2048,
      maxContextTokens: 24000,
      supportsVision: true,
      attachReferenceImages: true,
      maxReferenceImages: 3,
      jsonMode: true,
      isDefault: hasAnthropicKey,
      isVisionDefault: false,
    },
    {
      name: 'GPT-5 mini Compiler',
      providerConfigId: providers.openai.id,
      model: 'gpt-5-mini',
      temperature: 0.4,
      maxOutputTokens: 1600,
      maxContextTokens: 16000,
      supportsVision: true,
      attachReferenceImages: false,
      maxReferenceImages: 3,
      jsonMode: true,
      isDefault: false,
      isVisionDefault: false,
    },
    {
      name: 'Gemini 3.8 Flash Compiler',
      providerConfigId: providers.gemini.id,
      model: 'gemini-3.8-flash',
      temperature: 0.35,
      maxOutputTokens: 2048,
      maxContextTokens: 32000,
      supportsVision: true,
      attachReferenceImages: true,
      maxReferenceImages: 3,
      jsonMode: true,
      isDefault: false,
      isVisionDefault: hasGeminiKey,
    },
    {
      name: 'Gemini Web Guest Compiler (3.5 Flash Lite)',
      providerConfigId: providers.geminiWebGuest.id,
      model: 'gemini-web-guest:3.5-flash-lite',
      temperature: 0.35,
      maxOutputTokens: 2048,
      maxContextTokens: 24000,
      supportsVision: true,
      attachReferenceImages: true,
      maxReferenceImages: 3,
      jsonMode: true,
      isDefault: false,
      isVisionDefault: false,
    },
    {
      name: 'Gemini Web 4.0 Argon Compiler',
      providerConfigId: providers.geminiWebAuth.id,
      model: 'gemini-web:4.0-argon',
      temperature: 0.35,
      maxOutputTokens: 4096,
      maxContextTokens: 32000,
      supportsVision: true,
      attachReferenceImages: true,
      maxReferenceImages: 3,
      jsonMode: true,
      isDefault: false,
      isVisionDefault: false,
    },
    {
      name: 'AI Studio Gemini 4.0 Argon Compiler',
      providerConfigId: providers.aiStudio.id,
      model: 'aistudio:gemini-4.0-argon',
      temperature: 0.35,
      maxOutputTokens: 8192,
      maxContextTokens: 64000,
      supportsVision: true,
      attachReferenceImages: true,
      maxReferenceImages: 3,
      jsonMode: true,
      isDefault: false,
      isVisionDefault: false,
    },
    {
      name: 'Ollama Local Compiler',
      providerConfigId: providers.localOllama.id,
      model: 'qwen2.5:14b',
      temperature: 0.3,
      maxOutputTokens: 1600,
      maxContextTokens: 8000,
      supportsVision: false,
      attachReferenceImages: false,
      maxReferenceImages: 0,
      jsonMode: true,
      isDefault: false,
      isVisionDefault: false,
    },
  ];

  const profilesByName: Record<string, MiddlemanProfile> = {};
  for (const def of profileDefs) {
    const p = await ctx.prisma.middlemanProfile.create({ data: def });
    profilesByName[p.name] = p;
  }

  const templatesByModality = {} as Record<Modality, MiddlemanTemplate>;
  for (const tpl of SEED_MIDDLEMAN_TEMPLATES) {
    const created = await ctx.prisma.middlemanTemplate.create({
      data: {
        projectId: null,
        modality: tpl.modality,
        name: tpl.name,
        systemTemplate: tpl.systemTemplate,
        defaultNegativePrompt: tpl.defaultNegativePrompt,
        hardConstraints: tpl.hardConstraints,
        version: 1,
        isActive: true,
      },
    });
    templatesByModality[tpl.modality] = created;
  }

  return {
    profilesByName,
    defaultProfile: profilesByName['Demo Compiler (offline)']!,
    templatesByModality,
  };
}
