import { ContextScope, VaultFileKind, VisionStatus } from '@forge/shared';
import { VaultFile } from '@prisma/client';
import {
  ContextAssemblerService,
  ContextCandidate,
} from '../src/middleman/context-assembler.service';

function makeVaultFile(
  overrides: Partial<VaultFile> & { id: string; name: string; folderPath?: string },
): VaultFile & { folder: { path: string } } {
  const now = new Date('2026-10-22T12:00:00.000Z');
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

describe('ContextAssemblerService', () => {
  const assembler = new ContextAssemblerService();

  it('orders candidates: PINNED (in pin order) -> ALWAYS_INCLUDE (priority desc) -> SCOPE (priority desc)', async () => {
    const candidates: ContextCandidate[] = [
      {
        reason: 'SCOPE',
        file: makeVaultFile({
          id: 'scope_low',
          name: 'Scope Low.md',
          priority: 40,
          scopes: [ContextScope.ICONS_2D],
        }),
      },
      {
        reason: 'ALWAYS_INCLUDE',
        file: makeVaultFile({
          id: 'always_low',
          name: 'Always Low.md',
          priority: 60,
          scopes: [ContextScope.ALWAYS_INCLUDE],
        }),
      },
      {
        reason: 'PINNED',
        file: makeVaultFile({
          id: 'pin_first',
          name: 'Pin First.md',
          priority: 10,
          scopes: [ContextScope.ICONS_2D],
        }),
      },
      {
        reason: 'SCOPE',
        file: makeVaultFile({
          id: 'scope_high',
          name: 'Scope High.md',
          priority: 90,
          scopes: [ContextScope.ICONS_2D],
        }),
      },
      {
        reason: 'PINNED',
        file: makeVaultFile({
          id: 'pin_second',
          name: 'Pin Second.md',
          priority: 5,
          scopes: [ContextScope.ICONS_2D],
        }),
      },
      {
        reason: 'ALWAYS_INCLUDE',
        file: makeVaultFile({
          id: 'always_high',
          name: 'Always High.md',
          priority: 95,
          scopes: [ContextScope.ALWAYS_INCLUDE],
        }),
      },
    ];

    const res = await assembler.assemble(candidates, 10_000, {
      attachImages: false,
      maxImages: 0,
    });

    expect(res.included.map((f) => f.fileId)).toEqual([
      'pin_first',
      'pin_second',
      'always_high',
      'always_low',
      'scope_high',
      'scope_low',
    ]);
    expect(res.dropped).toHaveLength(0);
  });

  it('formats exact <vault_file> XML envelopes with product scope labels (2D_ICONS, 3D_ASSETS)', async () => {
    const file = makeVaultFile({
      id: 'clx_palette_1',
      name: 'Color Palette.md',
      folderPath: '/Art Direction',
      scopes: [ContextScope.ALWAYS_INCLUDE, ContextScope.ICONS_2D],
      contentText: 'Primary hex: #1B1446, Accent: #7C3AED',
    });

    const res = await assembler.assemble([{ file, reason: 'PINNED' }], 5000, {
      attachImages: false,
      maxImages: 0,
    });

    expect(res.blocks).toHaveLength(1);
    expect(res.blocks[0]?.envelopeXml).toBe(
      [
        '<vault_file id="clx_palette_1" name="Color Palette.md" folder="/Art Direction" scopes="ALWAYS_INCLUDE,2D_ICONS" reason="PINNED" truncated="false">',
        'Primary hex: #1B1446, Accent: #7C3AED',
        '</vault_file>',
      ].join('\n'),
    );
  });

  it('truncates PINNED / ALWAYS_INCLUDE files when remaining budget >= 300 tokens and drops SCOPE files that exceed budget', async () => {
    const longParagraph = 'A'.repeat(2400) + '\n' + 'B'.repeat(2400);
    const pinnedLarge = makeVaultFile({
      id: 'pin_large',
      name: 'Large Art Bible.md',
      contentText: longParagraph,
    });
    const scopeLarge = makeVaultFile({
      id: 'scope_drop',
      name: 'Extra Lore.md',
      contentText: longParagraph,
      scopes: [ContextScope.ICONS_2D],
    });

    // Budget of 500 tokens is < fullTokens (~1295), but >= 300 so PINNED is truncated while SCOPE is dropped
    const res = await assembler.assemble(
      [
        { file: pinnedLarge, reason: 'PINNED' },
        { file: scopeLarge, reason: 'SCOPE' },
      ],
      500,
      { attachImages: false, maxImages: 0 },
    );

    expect(res.included).toHaveLength(1);
    expect(res.included[0]?.fileId).toBe('pin_large');
    expect(res.included[0]?.truncated).toBe(true);
    expect(res.blocks[0]?.envelopeXml).toContain('truncated="true"');
    expect(res.blocks[0]?.envelopeXml).toContain('...[truncated]');

    expect(res.dropped).toHaveLength(1);
    expect(res.dropped[0]?.fileId).toBe('scope_drop');
  });

  it('renders IMAGE candidates using styleDescriptorText and paletteHex from styleDescriptorJson', async () => {
    const imageFile = makeVaultFile({
      id: 'img_ref_1',
      name: 'hud-icon-sheet.png',
      kind: VaultFileKind.IMAGE,
      mimeType: 'image/png',
      contentText: null,
      styleDescriptorText:
        'Cel-shaded RPG item icons with bold 3px dark ink outlines and warm gold rim light.',
      styleDescriptorJson: {
        paletteHex: ['#1B1446', '#7C3AED', '#F5C451'],
        lighting: 'Top-left key light',
        rendering: 'Hand-painted cel shading',
        linework: '3px tapered ink outline',
        proportions: 'Chunky stylized',
        materials: 'Matte stone and gleaming gold',
        composition: 'Centered die-cut',
        mood: 'Heroic arcane',
        doNot: ['photorealism'],
      },
    });

    const res = await assembler.assemble([{ file: imageFile, reason: 'PINNED' }], 5000, {
      attachImages: false,
      maxImages: 0,
    });

    expect(res.blocks[0]?.envelopeXml).toContain(
      'Cel-shaded RPG item icons with bold 3px dark ink outlines and warm gold rim light.',
    );
    expect(res.blocks[0]?.envelopeXml).toContain('Palette: #1B1446 #7C3AED #F5C451');
  });
});
