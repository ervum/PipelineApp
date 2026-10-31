import { ContextScope, VaultFileKind, VisionStatus } from '@forge/shared';
import { VaultFile } from '@prisma/client';
import sharp from 'sharp';
import { ContextAssemblerService } from '../src/middleman/context-assembler.service';
import { ImageProcessingService } from '../src/storage/image-processing.service';

function makeVaultFile(
  overrides: Partial<VaultFile> & { id: string; name: string; folderPath?: string },
): VaultFile & { folder: { path: string } } {
  const now = new Date('2026-10-31T02:00:00.000Z');
  return {
    id: overrides.id,
    projectId: overrides.projectId ?? 'proj_astra',
    folderId: overrides.folderId ?? 'fld_root',
    name: overrides.name,
    extension: overrides.extension ?? 'md',
    kind: overrides.kind ?? VaultFileKind.MARKDOWN,
    mimeType: overrides.mimeType ?? 'text/markdown',
    sizeBytes: overrides.sizeBytes ?? 256,
    storageKey: overrides.storageKey ?? null,
    thumbnailKey: overrides.thumbnailKey ?? null,
    checksumSha256: overrides.checksumSha256 ?? null,
    contentText: overrides.contentText ?? 'Default markdown body.',
    scopes: overrides.scopes ?? [ContextScope.ALWAYS_INCLUDE],
    priority: overrides.priority ?? 50,
    description: overrides.description ?? '',
    tokenEstimate: overrides.tokenEstimate ?? 20,
    styleDescriptorText: overrides.styleDescriptorText ?? null,
    styleDescriptorJson: overrides.styleDescriptorJson ?? null,
    visionStatus: overrides.visionStatus ?? VisionStatus.NONE,
    visionModel: overrides.visionModel ?? null,
    visionError: overrides.visionError ?? null,
    visionAnalyzedAt: overrides.visionAnalyzedAt ?? null,
    visionAttempts: overrides.visionAttempts ?? 0,
    width: overrides.width ?? null,
    height: overrides.height ?? null,
    durationMs: overrides.durationMs ?? null,
    metadata: overrides.metadata ?? {},
    sourceAssetId: overrides.sourceAssetId ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    folder: { path: overrides.folderPath ?? '/Art Direction' },
  };
}

describe('Phase 3 — Vault & Middleman Intelligence', () => {
  const assembler = new ContextAssemblerService();
  const imageProc = new ImageProcessingService();

  describe('3.1 Rich non-image Vault metadata rendering', () => {
    it('renders structured AUDIO, MODEL_3D, and VIDEO metadata into <vault_file> envelopes', async () => {
      const audioRef = makeVaultFile({
        id: 'vf_music_1',
        name: 'boss_combat_loop.wav',
        kind: VaultFileKind.AUDIO,
        mimeType: 'audio/wav',
        durationMs: 32000,
        description: 'Saved from generated asset "Citadel Boss Loop" (v1)',
        metadata: {
          bpm: 128,
          keySignature: 'D Minor',
          sampleRate: 44100,
          stems: ['drums.wav', 'bass.wav', 'choir.wav'],
          enhancedPrompt: 'Orchestral dark fantasy boss loop in D Minor at 128 BPM',
          tags: ['boss', 'combat'],
        },
      });

      const meshRef = makeVaultFile({
        id: 'vf_mesh_1',
        name: 'astral_halberd.glb',
        kind: VaultFileKind.MODEL_3D,
        mimeType: 'model/gltf-binary',
        metadata: {
          triangleCount: 4820,
          vertexCount: 2510,
          boundingBox: [0.45, 2.1, 0.18],
          hasPbr: true,
        },
      });

      const res = await assembler.assemble(
        [
          { file: audioRef, reason: 'PINNED' },
          { file: meshRef, reason: 'PINNED' },
        ],
        5000,
        { attachImages: false, maxImages: 0 },
      );

      expect(res.blocks[0]?.envelopeXml).toContain('BPM: 128');
      expect(res.blocks[0]?.envelopeXml).toContain('Key Signature: D Minor');
      expect(res.blocks[0]?.envelopeXml).toContain('Stems: drums.wav, bass.wav, choir.wav');
      expect(res.blocks[0]?.envelopeXml).toContain(
        'Prompt Context: Orchestral dark fantasy boss loop in D Minor at 128 BPM',
      );
      expect(res.blocks[1]?.envelopeXml).toContain(
        'Mesh Geometry: 4820 triangles, 2510 vertices',
      );
      expect(res.blocks[1]?.envelopeXml).toContain('Bounding Box: 0.45 x 2.1 x 0.18m');
      expect(res.blocks[1]?.envelopeXml).toContain('PBR Materials: yes');
    });
  });

  describe('3.2 & 3.3 Section-aware Markdown truncation & hybrid relevance ranking', () => {
    it('retains the bottom section of a multi-heading Markdown document when it matches rawPrompt', async () => {
      const fillerA = 'Ancient stone architecture and pillars. '.repeat(35);
      const fillerB = 'Lush subterranean moss gardens and glowing spores. '.repeat(35);
      const targetSection = [
        '## Obsidian Valkyrie Armor & Weapons',
        'Forged from star-fallen obsidian plates with violet ether runes (#7C3AED) and gold filigree (#F5C451).',
        'Wields the twin-bladed Astral Glaive with crystalline wing motifs.',
      ].join('\n');

      const docText = [
        '# World Codex Overview',
        'High-level world overview of the shattered sky realm.',
        '',
        '## Stone Architecture',
        fillerA,
        '',
        '## Subterranean Flora',
        fillerB,
        '',
        targetSection,
      ].join('\n');

      const codexFile = makeVaultFile({
        id: 'vf_codex',
        name: 'World Codex.md',
        contentText: docText,
      });

      // Budget of 420 tokens (~1560 chars) is much smaller than docText (~3300 chars),
      // forcing truncation. Head-only truncation would cut off the bottom section!
      const res = await assembler.assemble(
        [{ file: codexFile, reason: 'PINNED' }],
        420,
        {
          attachImages: false,
          maxImages: 0,
          rawPrompt: 'Obsidian Valkyrie armor with Astral Glaive weapon',
        },
      );

      expect(res.included[0]?.truncated).toBe(true);
      expect(res.blocks[0]?.envelopeXml).toContain(
        '## Obsidian Valkyrie Armor & Weapons',
      );
      expect(res.blocks[0]?.envelopeXml).toContain('Astral Glaive');
      expect(res.blocks[0]?.envelopeXml).toContain('...[section omitted]');
    });

    it('boosts relevant SCOPE candidates above unrelated SCOPE candidates of equal priority', async () => {
      const unrelatedScope = makeVaultFile({
        id: 'scope_unrelated',
        name: 'Tavern Cooking Recipes.md',
        priority: 60,
        contentText: 'Roasted boar stew, spiced cider, and hearth bread recipes.',
      });
      const relevantScope = makeVaultFile({
        id: 'scope_relevant',
        name: 'Chronomancer Spell VFX.md',
        priority: 60,
        contentText:
          'Temporal distortion rings, clockwork rune particles, and violet time-dilation shockwaves.',
      });

      const res = await assembler.assemble(
        [
          { file: unrelatedScope, reason: 'SCOPE' },
          { file: relevantScope, reason: 'SCOPE' },
        ],
        5000,
        {
          attachImages: false,
          maxImages: 0,
          rawPrompt: 'Chronomancer temporal distortion spell particle ring',
        },
      );

      expect(res.included.map((f) => f.fileId)).toEqual([
        'scope_relevant',
        'scope_unrelated',
      ]);
    });
  });

  describe('3.4 Palette compliance scoring & CIELAB palette remap', () => {
    it('scores on-palette vs off-palette images and improves paletteScore after remapToPalette()', async () => {
      const targetPalette = ['#1B1446', '#7C3AED', '#F5C451'];

      // Off-palette neon green/cyan image
      const offPaletteBuf = await sharp({
        create: {
          width: 64,
          height: 64,
          channels: 4,
          background: { r: 0, g: 245, b: 120, alpha: 1 },
        },
      })
        .png()
        .toBuffer();

      const beforeScore = await imageProc.scorePaletteCompliance(
        offPaletteBuf,
        targetPalette,
      );
      expect(beforeScore.paletteScore).toBeLessThan(40);

      const remappedBuf = await imageProc.remapToPalette(
        offPaletteBuf,
        targetPalette,
        0.9,
      );
      const afterScore = await imageProc.scorePaletteCompliance(
        remappedBuf,
        targetPalette,
      );
      expect(afterScore.paletteScore).toBeGreaterThan(beforeScore.paletteScore + 30);
    });
  });
});
