export const ASTRA_LYRA_MD = `# Lyra — Character Sheet (Protagonist Dreamforger)

## Overview
- **Age**: 19
- **Role**: Apprentice Dreamforger of House Lyra's Crown
- **Voice Profile**: \`demo-alto-warm\` — Soft alto with slight breathy warmth, earnest wonder, and steely resolve under pressure.
- **Catchphrase**: *"Every star remembers."*

## Visual Design & Palette Mapping
- **Silhouette**: Asymmetrical smithing apron over an agile star-weaver tunic; oversized crescent forge-gauntlet on her right arm (1.2x proportion rule) and a braided comet-tail scarf that trails luminous sparks.
- **Colour Mapping**:
  - Tunic & Cloak Base: Night Indigo (\`#1B1446\`) matte woven wool.
  - Arcane Trim & Scarf Gradient: Astral Violet (\`#7C3AED\`) fading into Nebula Cyan (\`#3CD3F0\`) at the tips.
  - Gauntlet & Hair Hairpins: Polished Starlight Gold (\`#F5C451\`) filigree with an Ember Coral (\`#FF6B5A\`) core gem.
  - Leather Straps & Apron: Aged Moon Ivory (\`#F4EFE6\`).

## Personality & Acting Direction
Lyra is observant, empathetic, and quietly stubborn. Unlike the elder smiths who treat star-fragments as inert ore, she listens to their hum before striking the anvil. In calm dialogue she speaks with gentle curiosity and measured pacing; in combat barks her delivery is crisp, breathless, and heroic.

## Sample Voice Lines
- **Dialogue (Discovery)**: *"Every star remembers the song it sang before the sky broke. Listen—this shard is still humming."*
- **Combat Bark (Skill Cast)**: *"Ignite the firmament!"*
- **Combat Bark (Parry)**: *"Not while this light holds!"*
`;

export const ASTRA_KAEL_MD = `# Kael — Character Sheet (Vanguard Star-Knight)

## Overview
- **Age**: 27
- **Role**: Exiled Captain of House Orion's Vigil
- **Voice Profile**: \`demo-baritone-dry\` — Low, grounded baritone with sardonic wit, clipped military cadence, and reluctant protective warmth.
- **Catchphrase**: *"Keep your eyes on the horizon, Kid."*

## Visual Design & Palette Mapping
- **Silhouette**: Broad-shouldered vanguard plate with an oversized left crescent pauldron (1.2x scale), weathered star-tattered half-cape, and a heavy greatsword scabbardslung across the back.
- **Colour Mapping**:
  - Armor Plates: Deep Night Indigo (\`#1B1446\`) brushed metal with Nebula Cyan (\`#3CD3F0\`) edge runes.
  - Pauldron Trim & Buckle Accents: Starlight Gold (\`#F5C451\`).
  - Under-surcoat: Moon Ivory (\`#F4EFE6\`) stained with ash at the hem.
  - Abyssal Scars on Shield Arm: Faint Astral Violet (\`#7C3AED\`) fracture lines from surviving the Hollow Tide.

## Personality & Acting Direction
Kael has seen three border citadels fall to the Hollow Tide and masks his grief behind dry, pragmatic humor. He avoids flowery words, speaks in short punchy clauses, and drops his voice half an octave when warning allies of danger.

## Sample Voice Lines
- **Dialogue (Campfire)**: *"Pretty blade. Just remember—the Tide doesn't care how bright the gold shines if your guard drops."*
- **Combat Bark (Taunt)**: *"Stay behind me."*
- **Combat Bark (Heavy Strike)**: *"Shatter!"*
`;

export const ASTRA_VESPER_MD = `# Oracle Vesper — Character Sheet (Seer of the Sanctum)

## Overview
- **Age**: Ageless (appears mid-40s, timeless)
- **Role**: High Seer of House Vespera Sanctum
- **Voice Profile**: \`demo-whisper-ancient\` — Whispery, resonant alto-mezzo with a slow, hypnotic cadence (\`speed 0.85\`) and layered ceremonial poise.
- **Catchphrase**: *"What falls in dream rises in iron."*

## Visual Design & Palette Mapping
- **Silhouette**: Flowing bell-sleeved ceremonial robes that hover slightly above the floor, a crescent-horned astrological headdress, and a Moon Ivory blindfold embroidered with golden constellations.
- **Colour Mapping**:
  - Robes: Layered Night Indigo (\`#1B1446\`) and Astral Violet (\`#7C3AED\`) silk with interior starfield lining.
  - Headdress & Thurible: Starlight Gold (\`#F5C451\`) filigree orbiting a suspended Nebula Cyan (\`#3CD3F0\`) prism.
  - Blindfold: Moon Ivory (\`#F4EFE6\`).

## Personality & Acting Direction
Vesper perceives past and future simultaneously as overlapping constellations. She never raises her voice, even in crisis; her power comes from stillness, deliberate pauses between clauses, and poetic riddles that always contain concrete visual imagery.

## Sample Voice Lines
- **Prophecy Narration**: *"When the fifth house weeps ember into indigo water, the sleeper beneath the anvil shall open its golden eye."*
- **Dialogue (Guidance)**: *"Do not force the edge, child. Let the star remember its own shape."*
`;

export const ASTRA_VOICE_CASTING_MD = `# Astra Dream — Voice Casting & Recording Direction

## Recording & Mix Standards
- **Microphone & Room**: Close-mic condenser capture (15–20 cm distance), completely dry studio booth with zero room reverb baked into source WAVs (reverb convolution is applied per biome in-engine).
- **Sample Rate & Format**: \`44.1 kHz\` or \`24 kHz\` 16-bit PCM mono WAV, normalized to \`-3.0 dBFS\` peak with clean 60 ms head and 100 ms tail silence.
- **Pacing & Breath**: Preserve natural human micro-pauses before celestial proper nouns (*Vesperia*, *Dreamforge*, *Hollow Tide*), but trim harsh mouth clicks and excessive inhales.

## Line Type Rules
1. **Barks (\`BARK\`)**: Strictly **2 to 8 words** (\`0.6s – 2.2s\`). Must cut through 150 BPM combat percussion with crisp consonant transients.
2. **Dialogue (\`DIALOGUE\`)**: Conversational intimacy; let character personality drive stability and style parameters.
3. **Prophecy & Lore Narration (\`NARRATION\`)**: Slower cadence (\`0.85x – 0.95x\`), high stability (\`0.65+\`), poetic gravity.

## Emotion Vocabulary Mapping
- \`HEROIC\`: Open chest resonance, forward projection, stability \`0.40\`, style \`0.55\`.
- \`WHISPER\`: Close-proximity airy tone, stability \`0.60\`, speed \`0.85\`.
- \`SARCASTIC\`: Dry, slightly flat inflection at clause endings, stability \`0.55\`.
`;

export const ASTRA_VFX_LANGUAGE_MD = `# Astra Dream — VFX Shape & Colour Language

## Shape Grammar
All visual effects in Astra Dream obey the same celestial geometry as the weapons and UI:
- **Primary Motifs**: Four-point diamond stars, sweeping crescent arcs, and teardrop nebula wisps.
- **Forbidden Motifs**: Hard hexagonal sci-fi grids, pixelated digital glitches, or thick opaque smoke clouds that obscure character silhouettes.

## Elemental & Rarity Colour Mapping
- **Starlight / Holy**: Core \`#FFFFFF\` → Inner bloom Starlight Gold \`#F5C451\` → Outer dissipation Astral Violet \`#7C3AED\`.
- **Nebula Frost / Mana**: Core \`#F4EFE6\` → Body Nebula Cyan \`#3CD3F0\` → Tail Night Indigo \`#1B1446\`.
- **Solar Ember / Mythic Strike**: Core \`#F5C451\` → Body Ember Coral \`#FF6B5A\` → Afterimage \`#1B1446\`.
- **Hollow Tide / Abyssal**: Pure Void \`#0B0820\` center rimmed by thin, unstable Astral Violet \`#7C3AED\` filaments.

## Spritesheet & Mask Standards
- Flipbook animations use \`4x4\` (16 frames) at \`256x256\` per cell, authored at \`12 – 24 FPS\`.
- Single-channel VFX masks (\`VFX_TEXTURE\`) must be centered on pure black (\`#000000\`) with smooth radial falloff to zero at the canvas borders so particles never clip into visible squares.
`;
