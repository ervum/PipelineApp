import { Prisma, VaultFile, VaultFolder, VoiceProfile } from '@prisma/client';
import { StorageKeys } from '../../src/storage/storage-keys';
import { synthesizeArtPng, synthesizeStyleBoardPng } from '../../src/synth/svg-art.synth';
import { synthesizeVoice } from '../../src/synth/wav-audio.synth';
import { ANIME_ART_BIBLE_MD } from './content/anime-art-bible.md';
import { ANIME_AUDIO_MD } from './content/anime-audio.md';
import { ANIME_AURA_VFX_MD } from './content/anime-aura-vfx.md';
import { ANIME_CHARACTERS_MD } from './content/anime-characters.md';
import { ANIME_GACHA_TABLE_JSON } from './content/anime-gacha-table.json';
import { ANIME_LUAU_CONVENTIONS_MD } from './content/anime-luau-conventions.md';
import { ANIME_PALETTE_MD } from './content/anime-palette.md';
import { ANIME_RANK_EMBLEMS_MD } from './content/anime-rank-emblems.md';
import {
  createVaultImageFileHelper,
  createVaultTextFileHelper,
  SeededProjectBundle,
} from './project-astra.seed';
import { SeededProvidersMap } from './providers.seed';
import { SeedContext } from './seed-context';

export async function seedProjectAnime(
  ctx: SeedContext,
  providers: SeededProvidersMap,
): Promise<SeededProjectBundle> {
  const project = await ctx.prisma.project.create({
    data: {
      slug: 'anime-awakening-rng',
      name: 'Anime Awakening RNG',
      tagline: 'Roll your destiny. Awaken your aura.',
      description:
        'A high-saturation Roblox anime RNG and aura gacha simulator featuring an 8-tier E-to-SSS rank ladder, explosive mobile-optimized Luau particle VFX, and hype tournament presentation.',
      genre: 'Roblox anime RNG / gacha simulator',
      accentHex: '#06B6D4',
      globalSummary: `Anime Awakening RNG is a Roblox gacha/RNG simulator where players roll for anime-inspired auras,
titles and awakened forms. Visual identity: high-saturation cel-shaded anime, thick clean outlines,
speed lines, explosive aura VFX. Rank ladder E → D → C → B → A → S → SS → SSS with escalating colour
and effects. Target platform Roblox (mobile-first readability, Luau scripting).
Core palette: Shonen Red #FF2E4D, Aura Cyan #22E1FF, Sakura Pink #FF7AC6, Thunder Yellow #FFE13B,
Void Purple #6B2BFF, Ink Black #0D0D14, Paper White #FAFAFF.`,
    },
  });

  // Project cover
  const coverPng = await synthesizeArtPng({
    prompt: 'Anime Awakening RNG shrine splash #0D0D14 #FF2E4D #22E1FF #FFE13B #6B2BFF',
    seed: ctx.nextSeedInt(),
    width: 1200,
    height: 630,
  });
  const coverWebp = await ctx.image.thumbnail(coverPng, 1200);
  const coverKey = StorageKeys.projectCover(project.id);
  const coverStored = await ctx.storage.putBuffer(coverKey, coverWebp, 'image/webp');
  ctx.recordBytes(coverStored.sizeBytes);
  await ctx.prisma.project.update({
    where: { id: project.id },
    data: { coverStorageKey: coverKey },
  });

  // Folders (8 total including Root)
  const foldersByPath: Record<string, VaultFolder> = {};
  const rootFolder = await ctx.prisma.vaultFolder.create({
    data: {
      projectId: project.id,
      parentId: null,
      name: 'Root',
      path: '/',
      sortOrder: 0,
    },
  });
  foldersByPath['/'] = rootFolder;

  const createFolder = async (
    parentPath: string,
    name: string,
    sortOrder: number,
  ): Promise<VaultFolder> => {
    const parent = foldersByPath[parentPath]!;
    const pathStr = parent.path === '/' ? `/${name}` : `${parent.path}/${name}`;
    const f = await ctx.prisma.vaultFolder.create({
      data: {
        projectId: project.id,
        parentId: parent.id,
        name,
        path: pathStr,
        sortOrder,
      },
    });
    foldersByPath[pathStr] = f;
    return f;
  };

  await createFolder('/', 'Art Direction', 1);
  await createFolder('/Art Direction', 'References', 1);
  await createFolder('/', 'VFX', 2);
  await createFolder('/', 'Scripting', 3);
  await createFolder('/', 'Characters', 4);
  await createFolder('/', 'Audio', 5);
  await createFolder('/', 'Data', 6);

  const filesByName: Record<string, VaultFile> = {};
  const registerText = async (
    folderPath: string,
    name: string,
    kind: 'MARKDOWN' | 'JSON',
    contentText: string,
    scopes: Prisma.VaultFileCreateInput['scopes'],
    priority: number,
    description: string,
  ): Promise<VaultFile> => {
    const f = await createVaultTextFileHelper(ctx, {
      projectId: project.id,
      folderId: foldersByPath[folderPath]!.id,
      name,
      kind,
      contentText,
      scopes: scopes as VaultFile['scopes'],
      priority,
      description,
    });
    filesByName[name] = f;
    return f;
  };

  await registerText(
    '/Art Direction',
    'Anime Art Bible.md',
    'MARKDOWN',
    ANIME_ART_BIBLE_MD,
    ['ALWAYS_INCLUDE'],
    95,
    'High-saturation cel-shaded anime rules, 4px Ink Black outlines, and Roblox mobile readability.',
  );
  await registerText(
    '/Art Direction',
    'Palette & Rank Colors.md',
    'MARKDOWN',
    ANIME_PALETTE_MD,
    ['ALWAYS_INCLUDE', 'ICONS_2D', 'IMAGES'],
    92,
    'Core neon shonen palette tokens and E-through-SSS rank color escalation ladder.',
  );
  await registerText(
    '/Art Direction',
    'Rank Emblem Spec.md',
    'MARKDOWN',
    ANIME_RANK_EMBLEMS_MD,
    ['ICONS_2D'],
    90,
    'Exact shape, primary/secondary hex colors, and FX rules for Rank E through Rank SSS emblems.',
  );

  // Synthesize rank-emblem-board.png (8 emblem shapes E->SSS)
  const emblemBoardPng = await synthesizeStyleBoardPng({
    title: 'Anime Awakening RNG — Rank Emblem Board (E → SSS)',
    subtitle: '4px Ink Black (#0D0D14) Outline · 2-Tone Cel Shading · Zero Text',
    swatches: [
      { label: 'Rank E', hex: '#8A8FA3' },
      { label: 'Rank D', hex: '#4ADE80' },
      { label: 'Rank C', hex: '#22E1FF' },
      { label: 'Rank B', hex: '#6B2BFF' },
      { label: 'Rank A', hex: '#FF2E4D' },
      { label: 'Rank S', hex: '#FFE13B' },
      { label: 'Rank SS', hex: '#FF7AC6' },
      { label: 'Rank SSS', hex: '#FAFAFF' },
    ],
    seed: ctx.nextSeedInt(),
    width: 1536,
    height: 1024,
  });

  filesByName['rank-emblem-board.png'] = await createVaultImageFileHelper(ctx, {
    projectId: project.id,
    folderId: foldersByPath['/Art Direction/References']!.id,
    name: 'rank-emblem-board.png',
    pngBuffer: emblemBoardPng,
    width: 1536,
    height: 1024,
    scopes: ['ICONS_2D'],
    priority: 85,
    description: 'Reference board of all 8 rank emblem silhouettes and color tiers (E to SSS).',
    styleDescriptorText:
      'High-saturation cel-shaded anime rank emblems with bold 4px Ink Black (#0D0D14) outer outlines, strong inner bevels, and zero text. Escalates from simple Slate Grey (#8A8FA3) circles to Aura Cyan (#22E1FF) shields, Shonen Red (#FF2E4D) hexagons, Thunder Yellow (#FFE13B) stars, Sakura Pink (#FF7AC6) double stars, and blinding Paper White (#FAFAFF) to Void Purple (#6B2BFF) radiant sun crowns.',
    styleDescriptorJson: {
      paletteHex: ['#0D0D14', '#FF2E4D', '#22E1FF', '#FFE13B', '#FF7AC6', '#6B2BFF', '#FAFAFF'],
      lighting: 'Hard anime specular bevel highlights with chromatic Void Purple (#6B2BFF) rim',
      rendering: 'Flat 2-tone cel-shading with hyper-saturated neon fills',
      linework: 'Crisp 4px Ink Black (#0D0D14) outer and inner comic linework',
      proportions: 'Bold symmetrical badge silhouettes readable at 48x48 on mobile',
      materials: 'Glossy anime enamel, glowing plasma arcs, metallic crest bevels',
      composition: 'Straight-on centered emblem badges with radial energy flares',
      mood: 'Explosive shonen tournament hype and prestige',
      doNot: ['letters or rank text inside icon', 'soft painterly airbrushing', 'muted colours'],
    },
  });

  // Synthesize aura-color-study.png
  const auraStudyPng = await synthesizeArtPng({
    prompt: 'Anime aura color study #0D0D14 #FF2E4D #22E1FF #FFE13B #6B2BFF #FF7AC6',
    seed: ctx.nextSeedInt(),
    width: 1024,
    height: 1024,
  });

  filesByName['aura-color-study.png'] = await createVaultImageFileHelper(ctx, {
    projectId: project.id,
    folderId: foldersByPath['/Art Direction/References']!.id,
    name: 'aura-color-study.png',
    pngBuffer: auraStudyPng,
    width: 1024,
    height: 1024,
    scopes: ['IMAGES', 'OTHER'],
    priority: 70,
    description: 'Aura flame shell and lightning arc color gradient study over Ink Black.',
    styleDescriptorText:
      'Explosive anime aura energy study over Ink Black (#0D0D14) featuring jagged Thunder Yellow (#FFE13B) lightning arcs, Shonen Red (#FF2E4D) plasma pillars, Aura Cyan (#22E1FF) speed lines, and Void Purple (#6B2BFF) outer gravity distortion rings.',
    styleDescriptorJson: {
      paletteHex: ['#0D0D14', '#FFE13B', '#FF2E4D', '#22E1FF', '#6B2BFF', '#FF7AC6'],
      lighting: 'High-contrast self-illuminated core against dark arena backdrop',
      rendering: 'Cel-shaded anime VFX ribbons and radial speed lines',
      linework: 'Tapered comic ink spikes on energy silhouettes',
      proportions: 'Oversized vertical aura plume 2.5x character height',
      materials: 'Pure plasma, electric arcs, glowing sakura petals',
      composition: 'Central upward energy eruption with concentric ground shockwave',
      mood: 'Overwhelming awakened power',
      doNot: ['realistic smoke', 'muddy gray transitions'],
    },
  });

  await registerText(
    '/VFX',
    'Aura VFX Guide.md',
    'MARKDOWN',
    ANIME_AURA_VFX_MD,
    ['OTHER', 'IMAGES'],
    85,
    'Four-layer aura anatomy, 4x4 256px flipbook spritesheet spec, and mobile emitter budgets.',
  );
  await registerText(
    '/Scripting',
    'Luau Conventions.md',
    'MARKDOWN',
    ANIME_LUAU_CONVENTIONS_MD,
    ['OTHER'],
    90,
    'Strict Roblox Luau coding standards, VFX module signature, and ParticleEmitter limits.',
  );
  const heroRosterFile = await registerText(
    '/Characters',
    'Hero Roster.md',
    'MARKDOWN',
    ANIME_CHARACTERS_MD,
    ['VOICES', 'IMAGES', 'ASSETS_3D'],
    70,
    'Character profiles and voice directions for Ren, Mika, Gorou, and the Shrine Announcer.',
  );
  await registerText(
    '/Audio',
    'Audio Direction.md',
    'MARKDOWN',
    ANIME_AUDIO_MD,
    ['MUSIC', 'SFX', 'VOICES'],
    88,
    'Kawaii synth-pop lobby BGM, J-rock combat tracks, roll tick escalation, and hype announcer.',
  );
  await registerText(
    '/Data',
    'gacha-table.json',
    'JSON',
    ANIME_GACHA_TABLE_JSON,
    ['OTHER'],
    60,
    'Rarity weights and 16 rollable anime auras across Ranks E through SSS.',
  );

  // Voice profiles (4)
  const voicesByName: Record<string, VoiceProfile> = {};
  const voiceDefs = [
    {
      name: 'Ren',
      characterSheetFileId: heroRosterFile.id,
      externalVoiceId: 'demo-tenor-raspy',
      description: 'Hot-headed shonen swordsman; raspy high-energy tenor with punchy delivery.',
      defaultSettings: { stability: 0.35, style: 0.65, speed: 1.08, emotionTags: ['SHOUT', 'HEROIC'] },
      sampleLine: 'My aura is already past the limit!',
    },
    {
      name: 'Mika',
      characterSheetFileId: heroRosterFile.id,
      externalVoiceId: 'demo-soprano-bright',
      description: 'Cheerful starlight mage; bright soprano with playful upward inflections.',
      defaultSettings: { stability: 0.45, style: 0.6, speed: 1.05, emotionTags: ['JOYFUL', 'PLAYFUL'] },
      sampleLine: 'The constellations are sparkling tonight!',
    },
    {
      name: 'Gorou',
      characterSheetFileId: heroRosterFile.id,
      externalVoiceId: 'demo-bass-deep',
      description: 'Stoic guardian giant; deep resonant bass with deliberate cadence.',
      defaultSettings: { stability: 0.7, style: 0.3, speed: 0.9, emotionTags: ['NEUTRAL'] },
      sampleLine: 'Stand firm before the gate.',
    },
    {
      name: 'Announcer',
      characterSheetFileId: null,
      externalVoiceId: 'demo-announcer-hype',
      description: 'Explosive arcade tournament announcer for high-rank gacha reveals.',
      defaultSettings: { stability: 0.3, style: 0.85, speed: 1.1, emotionTags: ['SHOUT', 'HEROIC'] },
      sampleLine: 'SSS RANK AWAKENED!',
    },
  ];

  for (const vDef of voiceDefs) {
    const vp = await ctx.prisma.voiceProfile.create({
      data: {
        projectId: project.id,
        name: vDef.name,
        characterSheetFileId: vDef.characterSheetFileId,
        providerConfigId: providers.demo.id,
        externalVoiceId: vDef.externalVoiceId,
        description: vDef.description,
        defaultSettings: vDef.defaultSettings as Prisma.InputJsonValue,
      },
    });
    const sampleSynth = synthesizeVoice({
      seed: ctx.nextSeedInt(),
      transcript: vDef.sampleLine,
      voiceId: vDef.externalVoiceId,
      speed: vDef.defaultSettings.speed,
    });
    const sampleKey = StorageKeys.voiceSample(project.id, vp.id, `${vDef.externalVoiceId}.wav`);
    const sampleStored = await ctx.storage.putBuffer(sampleKey, sampleSynth.wav, 'audio/wav');
    ctx.recordBytes(sampleStored.sizeBytes);
    voicesByName[vp.name] = await ctx.prisma.voiceProfile.update({
      where: { id: vp.id },
      data: { sampleStorageKey: sampleKey },
    });
  }

  return {
    project,
    foldersByPath,
    filesByName,
    voicesByName,
  };
}
