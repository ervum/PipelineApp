import { estimateTokens, StyleDescriptor } from '@forge/shared';
import { ContextScope, Prisma, Project, VaultFile, VaultFolder, VoiceProfile } from '@prisma/client';
import { extensionOf, mimeFromFilename } from '../../src/common/utils/mime';
import { StorageKeys } from '../../src/storage/storage-keys';
import { synthesizeArtPng, synthesizeStyleBoardPng } from '../../src/synth/svg-art.synth';
import { synthesizeIconPng } from '../../src/synth/svg-icon.synth';
import { synthesizeMusic, synthesizeVoice } from '../../src/synth/wav-audio.synth';
import { ASTRA_3D_STANDARDS_MD } from './content/astra-3d-standards.md';
import { ASTRA_ART_BIBLE_MD } from './content/astra-art-bible.md';
import {
  ASTRA_KAEL_MD,
  ASTRA_LYRA_MD,
  ASTRA_VESPER_MD,
  ASTRA_VFX_LANGUAGE_MD,
  ASTRA_VOICE_CASTING_MD,
} from './content/astra-characters.md';
import { ASTRA_ICON_GUIDE_MD } from './content/astra-icon-guide.md';
import { ASTRA_ITEMS_JSON } from './content/astra-items.json';
import { ASTRA_LORE_MD } from './content/astra-lore.md';
import { ASTRA_MUSIC_DIRECTION_MD } from './content/astra-music-direction.md';
import { ASTRA_NAMING_MD } from './content/astra-naming.md';
import { ASTRA_PALETTE_MD } from './content/astra-palette.md';
import { ASTRA_SFX_PALETTE_MD } from './content/astra-sfx-palette.md';
import { SeededProvidersMap } from './providers.seed';
import { SeedContext } from './seed-context';

export interface SeededProjectBundle {
  project: Project;
  foldersByPath: Record<string, VaultFolder>;
  filesByName: Record<string, VaultFile>;
  voicesByName: Record<string, VoiceProfile>;
}

export async function createVaultTextFileHelper(
  ctx: SeedContext,
  params: {
    projectId: string;
    folderId: string;
    name: string;
    kind: 'MARKDOWN' | 'TEXT' | 'JSON';
    contentText: string;
    scopes: ContextScope[];
    priority: number;
    description: string;
  },
): Promise<VaultFile> {
  const ext = extensionOf(params.name);
  const mime = mimeFromFilename(params.name, 'text/plain; charset=utf-8');
  const buf = Buffer.from(params.contentText, 'utf8');
  const tokens = estimateTokens(params.contentText);

  const created = await ctx.prisma.vaultFile.create({
    data: {
      projectId: params.projectId,
      folderId: params.folderId,
      name: params.name,
      extension: ext,
      kind: params.kind,
      mimeType: mime,
      sizeBytes: buf.length,
      contentText: params.contentText,
      scopes: params.scopes,
      priority: params.priority,
      description: params.description,
      tokenEstimate: tokens,
    },
  });

  const storageKey = StorageKeys.vaultFile(params.projectId, created.id, params.name);
  const stored = await ctx.storage.putBuffer(storageKey, buf, mime);
  ctx.recordBytes(stored.sizeBytes);

  return ctx.prisma.vaultFile.update({
    where: { id: created.id },
    data: {
      storageKey,
      checksumSha256: stored.sha256,
    },
  });
}

export async function createVaultImageFileHelper(
  ctx: SeedContext,
  params: {
    projectId: string;
    folderId: string;
    name: string;
    pngBuffer: Buffer;
    width: number;
    height: number;
    scopes: ContextScope[];
    priority: number;
    description: string;
    styleDescriptorText: string;
    styleDescriptorJson: StyleDescriptor;
  },
): Promise<VaultFile> {
  const tokens = estimateTokens(params.styleDescriptorText);
  const created = await ctx.prisma.vaultFile.create({
    data: {
      projectId: params.projectId,
      folderId: params.folderId,
      name: params.name,
      extension: 'png',
      kind: 'IMAGE',
      mimeType: 'image/png',
      sizeBytes: params.pngBuffer.length,
      scopes: params.scopes,
      priority: params.priority,
      description: params.description,
      tokenEstimate: tokens,
      styleDescriptorText: params.styleDescriptorText,
      styleDescriptorJson: params.styleDescriptorJson as unknown as Prisma.InputJsonValue,
      visionStatus: 'DONE',
      visionModel: 'seed',
      visionAnalyzedAt: new Date('2026-10-20T15:00:00Z'),
      width: params.width,
      height: params.height,
    },
  });

  const storageKey = StorageKeys.vaultFile(params.projectId, created.id, params.name);
  const thumbKey = StorageKeys.vaultThumb(params.projectId, created.id);
  const thumbBuf = await ctx.image.thumbnail(params.pngBuffer, 384);

  const [mainStored, thumbStored] = await Promise.all([
    ctx.storage.putBuffer(storageKey, params.pngBuffer, 'image/png'),
    ctx.storage.putBuffer(thumbKey, thumbBuf, 'image/webp'),
  ]);
  ctx.recordBytes(mainStored.sizeBytes + thumbStored.sizeBytes);

  return ctx.prisma.vaultFile.update({
    where: { id: created.id },
    data: {
      storageKey,
      thumbnailKey: thumbKey,
      checksumSha256: mainStored.sha256,
    },
  });
}

export async function seedProjectAstra(
  ctx: SeedContext,
  providers: SeededProvidersMap,
): Promise<SeededProjectBundle> {
  const project = await ctx.prisma.project.create({
    data: {
      slug: 'astra-dream',
      name: 'Astra Dream — 2D/3D Action RPG',
      tagline: 'A celestial action RPG where dreams are forged into weapons.',
      description:
        'A stylized 2D/3D celestial action RPG set in the shattered sky-realm of Vesperia, where Dreamforgers hammer fallen star-shards into resonant weapons and relics.',
      genre: 'Action RPG (2D/3D hybrid)',
      accentHex: '#7C3AED',
      globalSummary: `Astra Dream is a stylized celestial action RPG. Players are Dreamforgers who shape fragments of fallen
stars into weapons and relics. Visual identity: painterly cel-shaded forms, luminous starlight
accents on deep indigo night palettes, gold filigree trims. Tone: wondrous, melancholic, heroic.
Core palette: Night Indigo #1B1446, Astral Violet #7C3AED, Starlight Gold #F5C451, Nebula Cyan
#3CD3F0, Ember Coral #FF6B5A, Moon Ivory #F4EFE6. Rarity tiers: Common (ivory), Rare (cyan),
Epic (violet), Legendary (gold), Mythic (coral with gold).`,
    },
  });

  // Cover image
  const coverPng = await synthesizeArtPng({
    prompt: 'Astra Dream celestial citadel #1B1446 #7C3AED #F5C451 #3CD3F0',
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
  await createFolder('/', 'Lore', 2);
  await createFolder('/Lore', 'Characters', 1);
  await createFolder('/', 'Audio Direction', 3);
  await createFolder('/Audio Direction', 'References', 1);
  await createFolder('/', 'Design', 4);

  const filesByName: Record<string, VaultFile> = {};
  const registerText = async (
    folderPath: string,
    name: string,
    kind: 'MARKDOWN' | 'JSON',
    contentText: string,
    scopes: ContextScope[],
    priority: number,
    description: string,
  ): Promise<VaultFile> => {
    const f = await createVaultTextFileHelper(ctx, {
      projectId: project.id,
      folderId: foldersByPath[folderPath]!.id,
      name,
      kind,
      contentText,
      scopes,
      priority,
      description,
    });
    filesByName[name] = f;
    return f;
  };

  await registerText(
    '/Art Direction',
    'Art Bible.md',
    'MARKDOWN',
    ASTRA_ART_BIBLE_MD,
    ['ALWAYS_INCLUDE'],
    95,
    'Core visual pillars, painterly cel-shading rules, rim lighting, and shape grammar.',
  );
  await registerText(
    '/Art Direction',
    'Color Palette.md',
    'MARKDOWN',
    ASTRA_PALETTE_MD,
    ['ALWAYS_INCLUDE', 'ICONS_2D', 'IMAGES', 'ASSETS_3D'],
    90,
    'Master hex palette tokens, rarity tier mappings, and luminance rules.',
  );
  await registerText(
    '/Art Direction',
    'Icon Style Guide.md',
    'MARKDOWN',
    ASTRA_ICON_GUIDE_MD,
    ['ICONS_2D'],
    85,
    '1024px icon composition, 35-degree weapon rotation, shadow and silhouette rules.',
  );
  await registerText(
    '/Art Direction',
    '3D Asset Standards.md',
    'MARKDOWN',
    ASTRA_3D_STANDARDS_MD,
    ['ASSETS_3D'],
    85,
    'Polycount budgets, texel density, PBR roughness/metalness ranges, and glTF 2.0 conventions.',
  );

  // Synthesize astra-style-sheet.png (1536x1024 style board)
  const styleSheetPng = await synthesizeStyleBoardPng({
    title: 'Astra Dream — Master Style Board',
    subtitle: 'Painterly Cel-Shaded Celestial Action RPG',
    swatches: [
      { label: 'Night Indigo', hex: '#1B1446' },
      { label: 'Astral Violet', hex: '#7C3AED' },
      { label: 'Starlight Gold', hex: '#F5C451' },
      { label: 'Nebula Cyan', hex: '#3CD3F0' },
      { label: 'Ember Coral', hex: '#FF6B5A' },
      { label: 'Moon Ivory', hex: '#F4EFE6' },
    ],
    seed: ctx.nextSeedInt(),
    width: 1536,
    height: 1024,
  });

  const styleSheetDesc = `Painterly cel-shaded fantasy style with two-tone shadows and crisp ink-free edges. Deep Night Indigo
(#1B1446) backgrounds graded to Astral Violet (#7C3AED); luminous Starlight Gold (#F5C451) used only
for filigree trims and focal highlights; Nebula Cyan (#3CD3F0) rim lights from upper left. Soft bloom
on emissive star fragments, subtle sparkle particles, high readability silhouettes with chunky
proportions (1.2x oversized hilts and gems). Materials: polished gold, faceted crystal, matte cloth.`;

  filesByName['astra-style-sheet.png'] = await createVaultImageFileHelper(ctx, {
    projectId: project.id,
    folderId: foldersByPath['/Art Direction/References']!.id,
    name: 'astra-style-sheet.png',
    pngBuffer: styleSheetPng,
    width: 1536,
    height: 1024,
    scopes: ['ICONS_2D', 'IMAGES'],
    priority: 80,
    description: 'Master visual style board with palette swatches and silhouette studies.',
    styleDescriptorText: styleSheetDesc,
    styleDescriptorJson: {
      paletteHex: ['#1B1446', '#7C3AED', '#F5C451', '#3CD3F0', '#FF6B5A', '#F4EFE6'],
      lighting: 'Upper-left Nebula Cyan (#3CD3F0) rim light with single Starlight Gold (#F5C451) focal bloom',
      rendering: 'Painterly 2-tone cel-shading without dark ink outlines',
      linework: 'Ink-free edges defined by crisp value contrast',
      proportions: 'Stylized chunky 1.2x oversized hilts, pauldrons, and star-gems',
      materials: 'Polished Starlight Gold filigree, faceted star-crystal, matte indigo cloth',
      composition: 'High-readability silhouettes against deep Night Indigo gradients',
      mood: 'Wondrous, melancholic, heroic celestial fantasy',
      doNot: ['neon rainbow gradients', 'photographic noise', 'text or Latin runes'],
    },
  });

  // Synthesize starforged-katana-ref.png
  const katanaRefPng = await synthesizeIconPng({
    prompt: 'Starforged katana reference #1B1446 #F5C451 #3CD3F0 #7C3AED #FF6B5A',
    seed: ctx.nextSeedInt(),
    size: 1024,
    frameShape: 'NONE',
    removeBackground: false,
    solidBackgroundHex: '#1B1446',
  });
  const katanaRefDesc =
    'Curved celestial katana viewed at a 35-degree 3/4 angle against Night Indigo (#1B1446). Forged indigo-steel blade tapering into a star point with a Nebula Cyan (#3CD3F0) upper-left rim highlight, oversized 1.2x crescent guard in polished Starlight Gold (#F5C451) filigree housing a glowing Astral Violet (#7C3AED) star-crystal core, and Moon Ivory (#F4EFE6) wrapped grip.';

  filesByName['starforged-katana-ref.png'] = await createVaultImageFileHelper(ctx, {
    projectId: project.id,
    folderId: foldersByPath['/Art Direction/References']!.id,
    name: 'starforged-katana-ref.png',
    pngBuffer: katanaRefPng,
    width: 1024,
    height: 1024,
    scopes: ['ICONS_2D', 'ASSETS_3D'],
    priority: 60,
    description: 'Reference sheet for Starforged weapon proportions and crescent guard filigree.',
    styleDescriptorText: katanaRefDesc,
    styleDescriptorJson: {
      paletteHex: ['#1B1446', '#F5C451', '#3CD3F0', '#7C3AED', '#F4EFE6'],
      lighting: 'Sharp Nebula Cyan (#3CD3F0) edge rim and warm Starlight Gold (#F5C451) guard glow',
      rendering: 'Stylized hand-painted PBR metal and emissive crystal',
      linework: 'Clean bevel silhouettes without black outlines',
      proportions: '1.2x oversized crescent guard and pommel star',
      materials: 'Brushed indigo steel, polished gold filigree, faceted crystal',
      composition: 'Centered 35-degree diagonal weapon presentation',
      mood: 'Heroic, ancient celestial craftsmanship',
      doNot: ['sci-fi panels', 'grounded floor shadows', 'realistic rust'],
    },
  });

  await registerText(
    '/Lore',
    'World Lore.md',
    'MARKDOWN',
    ASTRA_LORE_MD,
    ['OTHER', 'IMAGES'],
    60,
    'Cosmology of the Shattered Firmament, the Dreamforge, five Constellation Houses, and the Hollow Tide.',
  );
  const lyraFile = await registerText(
    '/Lore/Characters',
    'Lyra - Character Sheet.md',
    'MARKDOWN',
    ASTRA_LYRA_MD,
    ['VOICES', 'IMAGES', 'ASSETS_3D'],
    70,
    'Protagonist Dreamforger character sheet: appearance, palette, personality, and voice direction.',
  );
  const kaelFile = await registerText(
    '/Lore/Characters',
    'Kael - Character Sheet.md',
    'MARKDOWN',
    ASTRA_KAEL_MD,
    ['VOICES', 'IMAGES'],
    70,
    'Vanguard Star-Knight character sheet: armor silhouette, sardonic baritone delivery, and barks.',
  );
  const vesperFile = await registerText(
    '/Lore/Characters',
    'Oracle Vesper - Character Sheet.md',
    'MARKDOWN',
    ASTRA_VESPER_MD,
    ['VOICES'],
    65,
    'High Seer of House Vespera Sanctum: whispery cadence, ceremonial robes, and prophecy lines.',
  );

  await registerText(
    '/Audio Direction',
    'Music Direction.md',
    'MARKDOWN',
    ASTRA_MUSIC_DIRECTION_MD,
    ['MUSIC'],
    90,
    'Celestial orchestral-electronic score bible, Astra’s Wish leitmotif in D Dorian, and BPM rules.',
  );
  await registerText(
    '/Audio Direction',
    'SFX Palette.md',
    'MARKDOWN',
    ASTRA_SFX_PALETTE_MD,
    ['SFX'],
    90,
    'Crystalline UI chimes, metal+crystal weapon hits, moonstone footsteps, and elemental magic layers.',
  );
  await registerText(
    '/Audio Direction',
    'Voice Casting Notes.md',
    'MARKDOWN',
    ASTRA_VOICE_CASTING_MD,
    ['VOICES'],
    80,
    'Close-mic dry recording standards, bark word-count limits, and emotion parameter mappings.',
  );

  // Synthesize astra-theme-sketch.wav (12s loop)
  const sketchAudio = synthesizeMusic({
    seed: ctx.nextSeedInt(),
    durationSec: 12,
    bpm: 92,
    keySignature: 'D Dorian',
    seamlessLoop: true,
    generateStems: false,
    sampleRate: 22050,
  });
  const sketchFile = await ctx.prisma.vaultFile.create({
    data: {
      projectId: project.id,
      folderId: foldersByPath['/Audio Direction/References']!.id,
      name: 'astra-theme-sketch.wav',
      extension: 'wav',
      kind: 'AUDIO',
      mimeType: 'audio/wav',
      sizeBytes: sketchAudio.masterWav.length,
      scopes: ['MUSIC'],
      priority: 50,
      description: '12-second reference motif sketch in D Dorian at 92 BPM.',
      tokenEstimate: 35,
      durationMs: sketchAudio.durationMs,
      metadata: { bpm: 92, keySignature: 'D Dorian', sampleRate: sketchAudio.sampleRate },
    },
  });
  const sketchKey = StorageKeys.vaultFile(project.id, sketchFile.id, sketchFile.name);
  const sketchStored = await ctx.storage.putBuffer(sketchKey, sketchAudio.masterWav, 'audio/wav');
  ctx.recordBytes(sketchStored.sizeBytes);
  filesByName['astra-theme-sketch.wav'] = await ctx.prisma.vaultFile.update({
    where: { id: sketchFile.id },
    data: { storageKey: sketchKey, checksumSha256: sketchStored.sha256 },
  });

  await registerText(
    '/Design',
    'Naming Conventions.md',
    'MARKDOWN',
    ASTRA_NAMING_MD,
    ['ALWAYS_INCLUDE'],
    75,
    'Canonical celestial item naming patterns, approved adjectives, and technical file naming.',
  );
  await registerText(
    '/Design',
    'items.json',
    'JSON',
    ASTRA_ITEMS_JSON,
    ['OTHER', 'ICONS_2D'],
    55,
    'Master table of 12 Astra Dream weapons, armor pieces, consumables, and relics.',
  );
  await registerText(
    '/Design',
    'VFX Language.md',
    'MARKDOWN',
    ASTRA_VFX_LANGUAGE_MD,
    ['OTHER', 'SFX'],
    60,
    'Star-point particle grammar, crescent slash arcs, and elemental hex gradients.',
  );

  // Voice profiles (3)
  const voicesByName: Record<string, VoiceProfile> = {};
  const voiceDefs = [
    {
      name: 'Lyra',
      characterSheetFileId: lyraFile.id,
      externalVoiceId: 'demo-alto-warm',
      description:
        '19-year-old apprentice Dreamforger; soft alto with slight breathy warmth and heroic determination.',
      defaultSettings: { stability: 0.45, style: 0.35, speed: 1.0, emotionTags: ['HEROIC'] },
      sampleLine: 'Every star remembers.',
    },
    {
      name: 'Kael',
      characterSheetFileId: kaelFile.id,
      externalVoiceId: 'demo-baritone-dry',
      description:
        '27-year-old exiled Star-Knight captain; low baritone with clipped cadence and sardonic warmth.',
      defaultSettings: { stability: 0.55, style: 0.3, speed: 1.0, emotionTags: ['SARCASTIC'] },
      sampleLine: 'Stay behind me.',
    },
    {
      name: 'Oracle Vesper',
      characterSheetFileId: vesperFile.id,
      externalVoiceId: 'demo-whisper-ancient',
      description:
        'Ageless seer of House Vespera Sanctum; whispery resonant cadence with slow ceremonial pacing.',
      defaultSettings: { stability: 0.65, style: 0.25, speed: 0.85, emotionTags: ['WHISPER'] },
      sampleLine: 'What falls in dream rises in iron.',
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
