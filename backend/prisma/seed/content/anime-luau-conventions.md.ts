export const ANIME_LUAU_CONVENTIONS_MD = `# Luau Conventions

- \`--!strict\` at the top of every ModuleScript; typed function signatures.
- Services fetched once: \`local TweenService = game:GetService("TweenService")\`.
- VFX modules expose \`Create(parent: BasePart, params: AuraParams): () -> ()\` returning a cleanup function.
- No custom shaders exist on Roblox: use ParticleEmitter, Beam, Trail, Highlight, PointLight, TweenService, and EditableImage.
- Colors as \`ColorSequence.new({ ColorSequenceKeypoint.new(0, Color3.fromHex("#22E1FF")), ... })\`.
- Performance: ≤ 3 ParticleEmitters per aura, \`Rate\` ≤ 40 on mobile, disable via \`Enabled = false\` (never Destroy mid-tween).
- Naming: PascalCase modules (\`AuraSSS.lua\`), camelCase locals, SCREAMING_CASE constants.
`;
