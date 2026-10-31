import { extractHexColors, mulberry32 } from './rng';

export interface SynthShaderOptions {
  prompt: string;
  seed: number;
  language: 'LUAU' | 'GDSCRIPT' | 'GODOT_SHADER' | 'HLSL' | 'GLSL';
  targetEngine: 'ROBLOX' | 'GODOT' | 'UNITY' | 'GENERIC';
  paletteFallback?: string[];
}

export interface SynthLoreJsonOptions {
  prompt: string;
  seed: number;
  schemaKind: 'ITEM_TABLE' | 'DIALOGUE_TREE' | 'QUEST' | 'NPC_ROSTER';
  entryCount: number;
  projectSlug?: string;
}

export interface SynthLoreTextOptions {
  prompt: string;
  seed: number;
  lengthForm: 'SHORT_FORM' | 'MEDIUM_FORM' | 'LONG_FORM';
  loreCategory: string;
  tone: string;
  perspective: string;
  targetWordCount: number;
  includeSections: boolean;
  outputFormat: 'MARKDOWN' | 'PLAIN_TEXT';
  projectName?: string;
}

export interface SynthLoreTextResult {
  text: string;
  wordCount: number;
  charCount: number;
  readingTimeSec: number;
  excerpt: string;
}

export function synthesizeShaderCode(opts: SynthShaderOptions): {
  code: string;
  extension: string;
  lineCount: number;
} {
  const colors = extractHexColors(opts.prompt, opts.paletteFallback ?? [
    '#FFFFFF',
    '#FFE13B',
    '#FF2E4D',
    '#6B2BFF',
    '#22E1FF',
  ]);
  const c0 = colors[0] ?? '#FFFFFF';
  const c1 = colors[1] ?? '#FFE13B';
  const c2 = colors[2] ?? '#FF2E4D';
  const c3 = colors[3] ?? '#6B2BFF';

  if (opts.language === 'LUAU') {
    const code = `--!strict
-- ForgeStudio Control Room — Procedural Roblox Luau VFX Module
-- Spec: ${opts.prompt.slice(0, 100).replace(/\r?\n/g, ' ')}

local TweenService = game:GetService("TweenService")

export type AuraParams = {
  intensity: number?,
  scale: number?,
  enablePointLight: boolean?,
}

local COLOR_CORE = "${c0}"
local COLOR_PRIMARY = "${c1}"
local COLOR_SECONDARY = "${c2}"
local COLOR_RIM = "${c3}"

local AuraVFX = {}

local function buildColorSequence(): ColorSequence
  return ColorSequence.new({
    ColorSequenceKeypoint.new(0.0, Color3.fromHex(COLOR_CORE)),
    ColorSequenceKeypoint.new(0.45, Color3.fromHex(COLOR_PRIMARY)),
    ColorSequenceKeypoint.new(0.8, Color3.fromHex(COLOR_SECONDARY)),
    ColorSequenceKeypoint.new(1.0, Color3.fromHex(COLOR_RIM)),
  })
end

local function buildSizeSequence(scale: number): NumberSequence
  return NumberSequence.new({
    NumberSequenceKeypoint.new(0.0, 0.4 * scale),
    NumberSequenceKeypoint.new(0.35, 1.85 * scale),
    NumberSequenceKeypoint.new(0.85, 1.2 * scale),
    NumberSequenceKeypoint.new(1.0, 0.0),
  })
end

function AuraVFX.Create(parent: BasePart, params: AuraParams): () -> ()
  local intensity = math.clamp(params.intensity or 1.0, 0.2, 2.0)
  local scale = math.clamp(params.scale or 1.0, 0.5, 3.0)

  local attachment = Instance.new("Attachment")
  attachment.Name = "ForgeAuraAttachment"
  attachment.Parent = parent

  -- 1. Core Flame Emitter (mobile budget: Rate <= 40)
  local coreEmitter = Instance.new("ParticleEmitter")
  coreEmitter.Name = "CoreAuraEmitter"
  coreEmitter.Color = buildColorSequence()
  coreEmitter.Size = buildSizeSequence(scale)
  coreEmitter.LightEmission = 0.85
  coreEmitter.Lifetime = NumberRange.new(0.45, 0.85)
  coreEmitter.Rate = math.floor(28 * intensity)
  coreEmitter.Speed = NumberRange.new(3.5 * scale, 7.0 * scale)
  coreEmitter.SpreadAngle = Vector2.new(25, 25)
  coreEmitter.LockedToPart = true
  coreEmitter.Parent = attachment

  -- 2. Rising Lightning Sparks Emitter
  local sparkEmitter = Instance.new("ParticleEmitter")
  sparkEmitter.Name = "SparkArcEmitter"
  sparkEmitter.Color = buildColorSequence()
  sparkEmitter.Size = NumberSequence.new(0.35 * scale, 0.0)
  sparkEmitter.LightEmission = 1.0
  sparkEmitter.Lifetime = NumberRange.new(0.25, 0.5)
  sparkEmitter.Rate = math.floor(18 * intensity)
  sparkEmitter.Speed = NumberRange.new(6.0 * scale, 12.0 * scale)
  sparkEmitter.SpreadAngle = Vector2.new(65, 65)
  sparkEmitter.Parent = attachment

  -- 3. Chromatic Rim Highlight
  local highlight = Instance.new("Highlight")
  highlight.Name = "AuraChromaticHighlight"
  highlight.FillColor = Color3.fromHex(COLOR_PRIMARY)
  highlight.OutlineColor = Color3.fromHex(COLOR_SECONDARY)
  highlight.FillTransparency = 0.72
  highlight.OutlineTransparency = 0.1
  highlight.Adornee = parent
  highlight.Parent = parent

  local pulseTween = TweenService:Create(
    highlight,
    TweenInfo.new(0.65, Enum.EasingStyle.Sine, Enum.EasingDirection.InOut, -1, true),
    { FillTransparency = 0.88, OutlineTransparency = 0.35 }
  )
  pulseTween:Play()

  return function()
    pulseTween:Cancel()
    coreEmitter.Enabled = false
    sparkEmitter.Enabled = false
    highlight.Enabled = false
    task.delay(1.0, function()
      if attachment.Parent then
        attachment:Destroy()
      end
      if highlight.Parent then
        highlight:Destroy()
      end
    end)
  end
end

return AuraVFX
`;
    return { code, extension: 'lua', lineCount: code.split('\n').length };
  }

  if (opts.language === 'GODOT_SHADER') {
    const code = `shader_type canvas_item;

uniform vec4 primary_color : source_color = vec4(0.486, 0.227, 0.929, 1.0);
uniform vec4 accent_color : source_color = vec4(0.961, 0.769, 0.318, 1.0);
uniform float pulse_speed : hint_range(0.1, 10.0) = 2.4;
uniform float rim_strength : hint_range(0.0, 2.0) = 1.15;

void fragment() {
  vec4 tex = texture(TEXTURE, UV);
  float pulse = 0.5 + 0.5 * sin(TIME * pulse_speed);
  vec3 glow = mix(primary_color.rgb, accent_color.rgb, pulse) * rim_strength;
  COLOR = vec4(tex.rgb + glow * tex.a, tex.a);
}
`;
    return { code, extension: 'gdshader', lineCount: code.split('\n').length };
  }

  const code = `// ForgeStudio Shader (${opts.language} / ${opts.targetEngine})
// Spec: ${opts.prompt.slice(0, 100).replace(/\r?\n/g, ' ')}
void main() {
  // Primary palette: ${c0}, ${c1}, ${c2}
}
`;
  const extMap: Record<SynthShaderOptions['language'], string> = {
    LUAU: 'lua',
    GDSCRIPT: 'gd',
    GODOT_SHADER: 'gdshader',
    HLSL: 'hlsl',
    GLSL: 'glsl',
  };
  return { code, extension: extMap[opts.language], lineCount: code.split('\n').length };
}

export function synthesizeLoreJson(opts: SynthLoreJsonOptions): {
  jsonText: string;
  parsed: unknown;
  lineCount: number;
} {
  const rng = mulberry32(opts.seed);
  const count = Math.max(1, opts.entryCount);

  const adjectives = [
    'Starforged',
    'Astral',
    'Emberfall',
    'Moonlit',
    'Nebula',
    'Voidtouched',
    'Celestial',
    'Solaris',
  ];
  const nouns = [
    'Katana',
    'Aegis',
    'Chalice',
    'Scepter',
    'Astrolabe',
    'Greaves',
    'Pendant',
    'Lantern',
  ];
  const houses = [
    "Lyra's Crown",
    "Orion's Vigil",
    'The Shattered Veil',
    'Vespera Sanctum',
    'Cygnus Spire',
  ];
  const rarities = ['Common', 'Rare', 'Epic', 'Legendary', 'Mythic'];
  const elements = ['Starlight', 'Nebula Frost', 'Ember Solar', 'Astral Void', 'Lunar Tide'];

  const entries = Array.from({ length: count }, (_, idx) => {
    const adj = adjectives[idx % adjectives.length]!;
    const noun = nouns[(idx + Math.floor(rng() * 3)) % nouns.length]!;
    const house = houses[idx % houses.length]!;
    const rarity = rarities[idx % rarities.length]!;
    const element = elements[idx % elements.length]!;

    return {
      id: `entry_${idx + 1}`,
      name: `${adj} ${noun} of ${house}`,
      schemaKind: opts.schemaKind,
      rarity,
      element,
      powerRating: 120 + idx * 45,
      loreSummary: `Forged beneath ${house}, this ${rarity.toLowerCase()} relic channels ${element.toLowerCase()} resonance.`,
    };
  });

  const payload = {
    schemaKind: opts.schemaKind,
    entryCount: entries.length,
    entries,
  };

  const jsonText = JSON.stringify(payload, null, 2);
  return {
    jsonText,
    parsed: payload,
    lineCount: jsonText.split('\n').length,
  };
}

export function synthesizeLoreText(opts: SynthLoreTextOptions): SynthLoreTextResult {
  const rng = mulberry32(opts.seed);
  const cleanPrompt = opts.prompt.trim().replace(/\s+/g, ' ');
  const subjectMatch = /([A-Z][a-zA-Z'-]+(?:\s+[A-Z][a-zA-Z'-]+){0,3})/.exec(cleanPrompt);
  const subjectName = subjectMatch?.[1] ?? 'Vespera of the Shattered Veil';
  const worldName = opts.projectName ?? 'Aethelgard';

  const houses = [
    "House Lyra's Crown",
    "The Order of Orion's Vigil",
    'The Shattered Veil Covenant',
    'Sanctum of the Astral Loom',
    'The Cinderforged Conclave',
  ];
  const eras = [
    'Third Convergence of Falling Stars',
    'Ashen Solstice of Year 412',
    'Eclipse of the Seventh Spire',
    'Twilight of the Astral Architects',
  ];
  const materials = [
    'starforged meteoric glass',
    'moon-quenched obsidian',
    'resonant void-brass',
    'aether-infused silver',
  ];

  const chosenHouse = houses[Math.floor(rng() * houses.length)]!;
  const chosenEra = eras[Math.floor(rng() * eras.length)]!;
  const chosenMaterial = materials[Math.floor(rng() * materials.length)]!;

  const isMarkdown = opts.outputFormat !== 'PLAIN_TEXT';
  let body = '';

  if (opts.lengthForm === 'SHORT_FORM') {
    const epigraph = `"Forged during the ${chosenEra}, when even the constellations bled into the sea." — Archivum of ${chosenHouse}`;
    const mainParagraph = `Crafted from ${chosenMaterial} by the artificers of ${chosenHouse}, **${subjectName}** hums with a quiet, gravitational resonance across ${worldName}. Prompted by the directive (${cleanPrompt.slice(0, 140)}), its surface refracts ambient starlight into razor-thin glyphs that awaken only in the presence of Astral rift energy. Those who bear it gain heightened attunement to the old ley-lines, though prolonged use leaves the wielder's fingertips cold as high-altitude frost.`;

    if (isMarkdown) {
      body = [
        `### ${subjectName}`,
        `> ${epigraph}`,
        '',
        mainParagraph,
        ...(opts.includeSections
          ? [
              '',
              '- **Origin**: ' + chosenHouse,
              '- **Material**: ' + chosenMaterial,
              '- **Category**: ' + opts.loreCategory.replace(/_/g, ' '),
            ]
          : []),
      ].join('\n');
    } else {
      body = `${subjectName}\n${epigraph}\n\n${mainParagraph.replace(/\*\*/g, '')}`;
    }
  } else if (opts.lengthForm === 'MEDIUM_FORM') {
    const sections = [
      isMarkdown ? `# ${subjectName}` : subjectName.toUpperCase(),
      isMarkdown
        ? `> *"Nothing in ${worldName} is truly lost; it merely waits beneath the veil of the ${chosenEra}."*`
        : `"Nothing in ${worldName} is truly lost; it merely waits beneath the veil of the ${chosenEra}."`,
      '',
      `Across the upper reaches of ${worldName}, few records survive the ${chosenEra} intact, yet the chronicle of **${subjectName}** remains etched into ${chosenMaterial} tablets preserved by ${chosenHouse}. Centered on the core premise (${cleanPrompt.slice(0, 180)}), this entry bridges the gap between ancient liturgical myth and the tangible relics recovered by frontier delvers.`,
      '',
      isMarkdown ? '## Origins & Significance' : 'ORIGINS & SIGNIFICANCE',
      `When the sky-anchors of ${chosenHouse} first began to drift, ${subjectName} emerged as a pivotal catalyst. Artisans and chroniclers noted how its presence altered the resonance of surrounding aether-conduits, drawing stray starlight into stable harmonic patterns. Field scholars who have studied the phenomenon describe three unmistakable traits: a persistent low-frequency chime at dusk, geometric frost patterns that form along nearby stone, and an uncanny pull toward the northernmost spire.`,
      '',
      isMarkdown ? '## Gameplay & Narrative Hooks' : 'GAMEPLAY & NARRATIVE HOOKS',
      `- **Rumored Location**: Sealed within the lower vaults beneath ${chosenHouse}.`,
      `- **Faction Interest**: Sought by both the sky-navigators and remnants of the Veil.`,
      `- **Dramatic Tension**: Activating its dormant core reveals hidden memories from the ${chosenEra}.`,
    ];
    body = sections.join('\n');
  } else {
    // LONG_FORM — Complete multi-chapter backstory / chronicle
    const chapters = [
      isMarkdown
        ? `# The Chronicle of ${subjectName}`
        : `THE CHRONICLE OF ${subjectName.toUpperCase()}`,
      isMarkdown
        ? `> *"Before the ${chosenEra} fractured the sky of ${worldName}, we believed our names were written in unbreakable light. ${subjectName} proved that even starlight can be reforged."* — High Chronicler Corvus of ${chosenHouse}`
        : `"Before the ${chosenEra} fractured the sky of ${worldName}, we believed our names were written in unbreakable light." — High Chronicler Corvus of ${chosenHouse}`,
      '',
      isMarkdown ? '## I. Prologue: Beneath the Falling Firmament' : 'I. PROLOGUE: BENEATH THE FALLING FIRMAMENT',
      `To understand the full history of **${subjectName}** within ${worldName}, one must look back to the final decades preceding the ${chosenEra}. Shaped by the creative vision (${cleanPrompt.slice(0, 220)}), the earliest accounts originate in the terraced observatories of ${chosenHouse}, where apprentices worked day and night with ${chosenMaterial} to chart the shifting constellations.`,
      '',
      `In those early years, the citadel was governed by strict harmonic law. Every citizen, relic, and oath was measured against the great Astrolabe of the Spire. Yet from the very beginning, ${subjectName} stood apart—marked by an anomalous resonance that refused to align with the orthodox charts. Elders whispered that such anomalies heralded either a generational breakthrough or the unmaking of the ward-stones that kept the Void at bay.`,
      '',
      isMarkdown ? '## II. Formative Years & The Crucible of the Spire' : 'II. FORMATIVE YEARS & THE CRUCIBLE OF THE SPIRE',
      `As tensions mounted between ${chosenHouse} and the outer provinces, ${subjectName} was thrust into the heart of the conflict. Trained in both the high dialect of the star-weavers and the pragmatic survival craft of the lower foundry wards, ${subjectName} learned to navigate a society split between gilded ceremony and desperate scarcity. Friendships forged in the soot-stained workshops of the third ring would later prove far more enduring than the political alliances of the High Council.`,
      '',
      `During the winter of the seventh convergence, a catastrophic surge in the lower aether-well threatened to collapse the eastern terrace. While the senior wardens hesitated—bound by protocol and fear of royal censure—${subjectName} descended into the flooded conduit chambers alone. Armed only with instruments of ${chosenMaterial} and an instinctive grasp of harmonic counter-frequencies, ${subjectName} stabilized the core at a permanent cost: a lingering astral brand that still flares whenever raw rift energy is near.`,
      '',
      isMarkdown ? '## III. The Turning Point of the Ashen Solstice' : 'III. THE TURNING POINT OF THE ASHEN SOLSTICE',
      `Instead of celebration, the rescue brought scrutiny. The Conclave's inquisitors demanded to know how an uninitiated hand had commanded the deep conduits without a royal key-sigil. Realizing that ${chosenHouse} intended to seal both the truth of the failing sky-anchors and anyone who had witnessed the fracture firsthand, ${subjectName} made a fateful choice on the eve of the ${chosenEra}.`,
      '',
      `Under cover of an eclipse storm, ${subjectName} recovered the encrypted star-ledgers from the upper archive and severed ties with the order. The pursuit across the shattered causeways of ${worldName} became legend among frontier drifters: a solitary figure carrying the forbidden truth of why the stars were cooling, hunted by the very sentinels once sworn as allies.`,
      '',
      isMarkdown ? '## IV. Present Era, Secrets & Motivations' : 'IV. PRESENT ERA, SECRETS & MOTIVATIONS',
      `Today, ${subjectName} operates at the crossroads of ${worldName}'s unfolding crisis. Outwardly composed, pragmatic, and fiercely protective of those cast aside by the High Houses, ${subjectName} pursues a singular goal: reawakening the dormant beacon network before the next convergence completes the fracture.`,
      '',
      `- **Core Drive**: Restore the true harmonic calibration of ${worldName} without surrendering power to the corrupt conclaves.`,
      `- **Hidden Secret**: The astral brand acquired in the conduit chamber is slowly translating a message from beyond the Shattered Veil.`,
      `- **Signature Relic**: A compass-blade of ${chosenMaterial} that points not toward magnetic north, but toward the nearest active star-shard.`,
      `- **Voice & Mannerisms**: Speaks with measured cadence (${opts.tone.toLowerCase().replace(/_/g, ' ')} tone), often pausing to listen to subtle vibrations in stone or metal before answering.`,
    ];
    body = chapters.join('\n');
  }

  if (!isMarkdown) {
    body = body.replace(/\*\*/g, '').replace(/\*/g, '');
  }

  const words = body
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0);
  const wordCount = words.length;
  const charCount = body.length;
  const readingTimeSec = Math.max(5, Math.round((wordCount / 200) * 60));
  const plainExcerpt = body
    .replace(/[#>*_`~-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 220);

  return {
    text: body + '\n',
    wordCount,
    charCount,
    readingTimeSec,
    excerpt: plainExcerpt,
  };
}
