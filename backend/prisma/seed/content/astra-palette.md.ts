export const ASTRA_PALETTE_MD = `# Astra Dream — Master Palette

| Token | Hex | Usage |
|---|---|---|
| Night Indigo | #1B1446 | Backgrounds, deep shadows, cloth |
| Astral Violet | #7C3AED | Epic rarity, magic auras, UI primary |
| Starlight Gold | #F5C451 | Legendary rarity, filigree, focal glows |
| Nebula Cyan | #3CD3F0 | Rare rarity, rim light, mana |
| Ember Coral | #FF6B5A | Mythic sparks, damage, fire |
| Moon Ivory | #F4EFE6 | Common rarity, highlights, parchment |
| Abyss Black | #0B0820 | Icon outer shadow, vignette |

## Rarity mapping (icons, item frames, VFX)
- Common → Moon Ivory frame, no glow
- Rare → Nebula Cyan frame, faint cyan glow
- Epic → Astral Violet frame, violet aura particles
- Legendary → Starlight Gold frame, gold bloom + filigree
- Mythic → Ember Coral + Starlight Gold dual frame, coral sparks

## Value rules
Subject value range must span ≥ 60% of the luminance scale; backgrounds stay below 25% luminance.
`;
