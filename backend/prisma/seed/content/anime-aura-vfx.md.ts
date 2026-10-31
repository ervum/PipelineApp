export const ANIME_AURA_VFX_MD = `# Anime Awakening RNG — Aura VFX Architecture & Flipbook Guide

## Four-Layer Aura Anatomy
Every awakened aura equipped by a player in Roblox is assembled from up to four synchronized layers (scaled down for lower ranks):
1. **Core Flame Shell**: Locked to the character’s \`HumanoidRootPart\`. Uses a cel-shaded upward flame silhouette that steps through the rank's primary and secondary hex colors.
2. **Rising Sparks & Debris**: Upward-accelerating embers, sakura petals, or void cubes that spiral around the character silhouette.
3. **Ground Shockwave Ring**: An orthographic decal / particle ring at feet level (\`Y = 0.05\`) with rotating runes and radial speed lines.
4. **Lightning Arcs & Chromatic Rim**: Reserved for Rank \`S\`, \`SS\`, and \`SSS\`. Uses a \`4x4\` flipbook spritesheet of jagged anime lightning combined with a pulsing \`Highlight\` instance.

## Flipbook Spritesheet Specification
- **Grid Layout**: \`4 columns x 4 rows\` (\`16 frames\` total), reading left-to-right, top-to-bottom.
- **Resolution**: \`256x256\` pixels per frame cell (\`1024x1024\` master texture sheet) at \`12\` to \`24 FPS\`.
- **Framing & Alpha**: Every frame must keep the energy arc centered within the cell with at least \`16px\` padding from cell borders so adjacent frames never bleed during bilinear texture filtering.

## Mobile Performance Guardrails
- Maximum **3 active \`ParticleEmitter\` instances** per character aura.
- Particle \`Rate\` must stay \`<= 40\` per emitter to maintain 60 FPS in 20-player lobby servers.
`;
