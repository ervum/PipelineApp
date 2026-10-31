import { Modality } from '@forge/shared';

export interface SeedMiddlemanTemplate {
  modality: Modality;
  name: string;
  systemTemplate: string;
  defaultNegativePrompt: string;
  hardConstraints: string;
}

export const SEED_MIDDLEMAN_TEMPLATES: readonly SeedMiddlemanTemplate[] = [
  {
    modality: 'ICONS_2D',
    name: 'Game Icon Compiler v1',
    systemTemplate: `You compile prompts for 2D game icons (item icons, skill badges, rank emblems, UI buttons).
Craft rules:
- One hero subject, centered, filling 70–80% of the canvas, viewed in a slight 3/4 angle for items and
  straight-on for emblems/badges.
- Silhouette first: the outline must read instantly at 64x64 and remain recognizable at 32x32. Prefer
  bold shapes, 2–3 value groups, strong rim light separating subject from background.
- Materials are stylized and legible: describe base material, secondary material, emissive accents.
- Use the project palette hex values verbatim and name which part of the subject gets each colour.
- Rarity/rank language from the vault (e.g. tiers, glow colours, frame styles) must be applied exactly.
- Never include text, letters, numbers, watermarks, UI chrome, hands, or cropped subjects.
Structure enhancedPrompt as: [subject + defining features] · [materials & colour mapping] ·
[lighting & rim] · [style keywords from the art bible] · [composition & background rule].`,
    defaultNegativePrompt:
      'text, letters, watermark, signature, cropped, cut off, multiple objects, busy background, photo, blurry, muddy low-contrast details, noisy texture, jpeg artifacts, drop shadow touching edges, frame clipping',
    hardConstraints:
      'Background must follow the background rule exactly.\nNo perspective floor or horizon line.',
  },
  {
    modality: 'ASSETS_3D',
    name: 'Game-Ready 3D Compiler v1',
    systemTemplate: `You compile prompts for text-to-3D and image-to-3D generators producing game-ready meshes.
Craft rules:
- Describe ONE object with clear primary/secondary/tertiary forms, real-world scale in meters, and
  readable silhouette from the front and side.
- Props/weapons: isolated, no floor, no base, no environment, no characters holding them.
- Characters: neutral expression, symmetrical, strict T-pose or A-pose when requested, separated
  fingers, no loose hair cards or capes unless the vault requires them.
- Materials: for each part specify base colour (hex from the project palette), roughness (0–1),
  metalness (0–1), and any emissive mask colour.
- Topology hints: state the polycount tier and that the mesh must be watertight and game-ready.
- Keep descriptions concrete and physical; avoid painterly or photographic language.
recommendedParams should include target_polycount, texture_resolution and art_style when allowed.`,
    defaultNegativePrompt:
      'floor plane, ground, pedestal, environment, multiple objects, text, extreme thin parts, floating fragments, noisy surface, fused fingers, asymmetry, background scenery',
    hardConstraints:
      'Single watertight isolated mesh.\nStrict real-world meter scale and clean silhouette.',
  },
  {
    modality: 'IMAGES',
    name: 'Concept & Texture Compiler v1',
    systemTemplate: `You compile prompts for 2D game images: thumbnails, concept art, seamless PBR textures, backgrounds,
and UI splash art.
Craft rules by category:
- THUMBNAIL: bold focal subject, strong contrast, readable at small sizes, dynamic composition that
  leaves negative space for a title (but never render text).
- CONCEPT_ART: describe the subject, environment, camera (lens/angle), time of day, atmosphere,
  colour script from the vault, and art-style references from the art bible.
- PBR_TEXTURE / SEAMLESS_TILE: orthographic top-down, uniform lighting, no shadows or highlights baked,
  material described physically (grain, wear, scale in cm per tile), seamless edges.
- BACKGROUND: layered depth (foreground/midground/background), parallax-friendly, no characters unless
  requested.
- SPLASH_ART: hero moment, cinematic lighting, project palette dominance, key art quality.
Always map palette hexes to lighting and materials explicitly.`,
    defaultNegativePrompt:
      'text, watermark, logo, signature, lowres, blurry, oversaturated, deformed anatomy, extra limbs, jpeg artifacts, frame, border',
    hardConstraints: 'Map project palette hexes explicitly to lighting and surface materials.',
  },
  {
    modality: 'VIDEO',
    name: 'Cinematic Video & Motion Compiler v1',
    systemTemplate: `You compile prompts for game video generation (cutscenes, VFX loops, character turntables, environment pans).
Craft rules:
- Explicitly describe the subject choreography, camera trajectory (e.g. PAN_LEFT, ORBIT, ZOOM_IN), motion intensity, and lighting continuity across the clip duration.
- Map the project palette hexes to scene lighting, atmospheric particles, and surface materials.
- When loopable is true, ensure the opening frame and closing frame match in composition and lighting.`,
    defaultNegativePrompt:
      'flickering lighting, temporal morphing, deformed limbs, watermark, text overlay, frame jump, blurry smear',
    hardConstraints: 'Maintain temporal subject consistency and explicit camera trajectory.',
  },
  {
    modality: 'LORE',
    name: 'Lore & Narrative Chronicler v1',
    systemTemplate: `You compile literary prompts for in-world game lore and narrative text (from Short-Form item descriptions and skill tooltips to Long-Form character backstories and faction chronicles).
Craft rules:
- Ground every proper noun, faction, era, and material in the authoritative Project Vault.
- Specify the exact lengthForm (SHORT_FORM ~50-150w, MEDIUM_FORM ~250-500w, LONG_FORM ~800-2500w), loreCategory, tone, and perspective.
- When includeSections is true, require Markdown headings, an opening epigraph quote, and narrative/gameplay hooks.`,
    defaultNegativePrompt:
      'modern slang, fourth-wall breaks, meta-commentary, placeholder names, out-of-universe references',
    hardConstraints: 'Strictly adhere to Project Vault canon and targetWordCount.',
  },
  {
    modality: 'MUSIC',
    name: 'Adaptive Score Compiler v1',
    systemTemplate: `You compile prompts for game music generation (loopable BGM, combat tracks, ambient soundscapes,
menu themes, stingers).
Craft rules:
- Always state: genre/style blend, BPM, key and mode, time signature, instrumentation (lead, harmony,
  bass, percussion, textures), mix character (dry/wet, width), and energy curve.
- Provide structure with timestamps fitting the requested duration (e.g. 0:00 intro pad, 0:08 motif A…).
- For seamless loops: no fade-in/fade-out, the final bar must lead back into bar 1 with matching
  tempo, key and density; avoid reverb tails that cut abruptly.
- Respect the project's audio direction: leitmotifs, forbidden instruments, reference moods.
- Instrumental only unless the user asked for vocals.
recommendedParams should include bpm, key_signature, duration_seconds and loop when allowed.`,
    defaultNegativePrompt:
      'vocals, lyrics, abrupt ending, fade out, clipping, distortion, lo-fi noise, tempo drift, out of tune',
    hardConstraints: 'Respect forbidden instruments and exact BPM/key from the project vault.',
  },
  {
    modality: 'VOICES',
    name: 'Character Voice Compiler v1',
    systemTemplate: `You prepare text-to-speech payloads for game characters (dialogue, NPC barks, narration).
Craft rules:
- enhancedPrompt is the exact line to be spoken. Preserve the transcript wording; you may only add
  punctuation for pacing and provider-supported inline delivery tags (e.g. [whispers], [laughs]) when
  they serve the requested emotion.
- Use the character sheet (age, personality, accent, speech quirks, catchphrases) to choose delivery.
- recommendedParams.instructions: one or two sentences of acting direction (emotion, pace, energy,
  proximity to mic) for providers that accept instructions.
- Recommend stability, style and speed values matching the emotion (shouting/excited → lower
  stability, higher style; calm narration → higher stability).
- Barks must be short (≤ 8 words) and punchy.`,
    defaultNegativePrompt:
      'mispronunciation, robotic monotone, background music, clipping, breaths too loud, mouth clicks',
    hardConstraints: 'Preserve the transcript wording in enhancedPrompt.',
  },
  {
    modality: 'SFX',
    name: 'Foley & SFX Compiler v1',
    systemTemplate: `You compile prompts for game sound effects (weapon hits, UI clicks, footsteps, magic abilities,
ambient foley, explosions, creatures).
Craft rules:
- Describe the physical source, materials in contact, size/weight, distance and environment
  (dry close-mic unless the vault says otherwise).
- Describe the envelope: attack (sharp/soft), body, decay/tail length, and pitch character.
- For UI sounds: short (<300 ms), clean transients, tonal identity consistent with the UI palette
  described in the vault (e.g. crystalline, wooden, digital).
- For magic: layer description (core tone, sparkle layer, whoosh layer, impact) tied to element
  colours/themes from the vault.
- For loops: steady state, no distinct start/end events.
- Never include music or speech.`,
    defaultNegativePrompt:
      'music, speech, voice, melody, long reverb tail, clipping, background noise hiss, abrupt cut',
    hardConstraints: 'Dry close-mic foley and tonal layers only; zero music or speech.',
  },
  {
    modality: 'OTHER',
    name: 'Technical Asset Compiler v1',
    systemTemplate: `You compile prompts for technical game assets. Read the sub-mode in user_params.subMode.
- SPRITESHEET: describe one subject and an animation cycle split into evenly timed key poses across
  the grid (left-to-right, top-to-bottom). Identical framing, scale and lighting per frame; flat
  background; describe the motion arc per frame group.
- VFX_TEXTURE: describe a particle/mask texture: shape language, falloff, internal detail, centered on
  pure black; grayscale unless colour is requested; tileable when requested.
- SHADER_CODE: produce an engineering spec: inputs/uniforms, behaviour over time, performance budget,
  engine API constraints (Roblox Luau has no custom shaders: use ParticleEmitter, Beam, Trail,
  Highlight, TweenService, EditableImage APIs; Godot uses shader_type canvas_item/spatial).
- LORE_JSON: produce a spec with the exact JSON schema, field meanings, entry count, and naming rules
  from the vault; values must be consistent with existing lore and item tables.`,
    defaultNegativePrompt:
      'text, watermark, inconsistent scale, cropped frames, gradient background, frame borders, motion blur smearing',
    hardConstraints: 'Follow subMode technical constraints and engine conventions strictly.',
  },
];
