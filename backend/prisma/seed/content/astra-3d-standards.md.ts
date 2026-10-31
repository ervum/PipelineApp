export const ASTRA_3D_STANDARDS_MD = `# Astra Dream — 3D Asset Standards (v1.9)

## Polycount & Topology Budgets
All meshes must be watertight, manifold, and authored for real-time action RPG camera distances (both isometric combat and close-up forge inspection).
- **Environment Props (` + '`PROP`' + `)**: \`1,500 – 5,000\` triangles (` + '`LOW_POLY`' + ` default target ~5,000 tris). Beveled silhouettes rather than normal-mapped sharp 90-degree corners.
- **Hero Weapons & Relics (` + '`WEAPON`' + `)**: \`3,000 – 8,000\` triangles. Extra edge loops reserved for curved crescent blades, oversized hilts (1.2x scale rule), and star-crystal sockets.
- **Hero & NPC Characters (` + '`CHARACTER_BASE`' + `)**: \`25,000 – 40,000\` triangles (` + '`MID_POLY`' + `). Clean quad-dominant deformation loops around shoulders, elbows, knees, and facial mask; separated fingers in strict A-pose (45-degree arm angle) or T-pose.

## Coordinate Space, Scale & Pivots
- **World Units**: \`1.0 unit = 1.0 meter\`. Up-axis is \`+Y\`, forward-axis is \`+Z\`, right-handed coordinate system.
- **Pivot Placement**:
  - Weapons: centered directly at the primary hand grip node so the character socket attaches with zero offset.
  - Props & Environment pieces: centered at the lowest bounding-box base plane (\`Y = 0.0\`).
  - Characters: centered between the heels at floor level (\`Y = 0.0\`), perfectly symmetrical across the \`X = 0\` plane.

## UV & PBR Material Pipeline
- **Texel Density**: \`512 px / meter\` minimum across hero props; \`2048x2048\` default texture resolution.
- **Material Slots**: Maximum **2 materials** per prop or weapon (primary opaque PBR + optional emissive star-crystal shader).
- **PBR Channels (Metallic / Roughness Workflow)**:
  - **Polished Starlight Gold Filigree (\`#F5C451\`)**: Metalness \`0.85 – 0.95\`, Roughness \`0.18 – 0.28\`.
  - **Night Indigo Forged Steel (\`#1B1446\`)**: Metalness \`0.65 – 0.78\`, Roughness \`0.35 – 0.48\`.
  - **Faceted Star-Crystal (\`#3CD3F0\` / \`#7C3AED\`)**: Metalness \`0.10\`, Roughness \`0.12\`, Emissive core mask.
  - **Aged Moon-Ivory Leather & Cloth (\`#F4EFE6\`)**: Metalness \`0.0\`, Roughness \`0.72 – 0.88\`.

## Export & Naming Convention
- Export format: binary glTF 2.0 (\`.glb\`) with embedded PBR textures, tangents, and vertex normals.
- Asset naming pattern: \`SM_<Category>_<Name>_<Variant>\` (e.g. \`SM_Weapon_StarforgedKatana_01\`, \`SM_Prop_DreamforgeAnvil_01\`).
`;
