export const ANIME_RANK_EMBLEMS_MD = `# Rank Emblem Spec

| Rank | Shape | Primary | Secondary | FX |
|---|---|---|---|---|
| E | Plain circle | #8A8FA3 | #0D0D14 | none |
| D | Circle + single ring | #4ADE80 | #0D0D14 | none |
| C | Shield | #22E1FF | #0D0D14 | faint glow |
| B | Shield + wings | #6B2BFF | #22E1FF | glow |
| A | Hexagon crest | #FF2E4D | #FFE13B | sparks |
| S | Star crest | #FFE13B | #FF2E4D | lightning arcs |
| SS | Double star crest | #FF7AC6 | #FFE13B | lightning + petals |
| SSS | Radiant sun crest, crown | #FFFFFF core → #FFE13B → #FF2E4D | #6B2BFF | full aura burst, chromatic rim |

- Letters are added in-engine via TextLabel — emblems must contain **no text**.
- 4px Ink Black (#0D0D14) outline at 512px; cel-shaded 2 tones; strong inner bevel.
- Must read on both dark and light UI at 48×48.
`;
