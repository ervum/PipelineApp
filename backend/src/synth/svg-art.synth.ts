import sharp from 'sharp';
import { extractHexColors, mulberry32 } from './rng';

export interface SynthArtOptions {
  prompt: string;
  seed: number;
  width: number;
  height: number;
  tileable?: boolean;
  grayscale?: boolean;
  paletteFallback?: string[];
  title?: string;
}

export interface SynthStyleBoardOptions {
  title: string;
  subtitle: string;
  swatches: Array<{ label: string; hex: string }>;
  seed: number;
  width?: number;
  height?: number;
}

export interface SynthSpritesheetOptions {
  prompt: string;
  seed: number;
  columns: number;
  frameCount: number;
  frameSize: 64 | 128 | 256 | 512;
  paletteFallback?: string[];
}

export async function synthesizeStyleBoardPng(opts: SynthStyleBoardOptions): Promise<Buffer> {
  const rng = mulberry32(opts.seed);
  const width = opts.width ?? 1536;
  const height = opts.height ?? 1024;
  const c0 = opts.swatches[0]?.hex ?? '#1B1446';
  const c1 = opts.swatches[1]?.hex ?? '#7C3AED';
  const c2 = opts.swatches[2]?.hex ?? '#F5C451';
  const c3 = opts.swatches[3]?.hex ?? '#3CD3F0';

  const stars: string[] = [];
  for (let i = 0; i < 45; i++) {
    const x = Math.round(rng() * width);
    const y = Math.round(rng() * (height * 0.65));
    const r = (1.5 + rng() * 3.5).toFixed(1);
    const col = i % 3 === 0 ? c2 : i % 3 === 1 ? c3 : '#FFFFFF';
    stars.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="${col}" opacity="${(0.4 + rng() * 0.6).toFixed(2)}" />`);
  }

  const swatchWidth = Math.floor((width - 160) / Math.max(1, opts.swatches.length));
  const swatchRects = opts.swatches
    .map((sw, idx) => {
      const x = 80 + idx * swatchWidth;
      const y = height - 240;
      const w = swatchWidth - 16;
      return `
        <g>
          <rect x="${x}" y="${y}" width="${w}" height="150" rx="14" fill="${sw.hex}" stroke="#FFFFFF" stroke-opacity="0.25" stroke-width="3" />
          <rect x="${x}" y="${y + 104}" width="${w}" height="46" rx="8" fill="#0B0820" fill-opacity="0.78" />
          <text x="${x + 14}" y="${y + 132}" fill="#FFFFFF" font-family="sans-serif" font-size="18" font-weight="bold">${sw.label} (${sw.hex})</text>
        </g>`;
    })
    .join('\n');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <defs>
      <linearGradient id="sky" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${c0}" />
        <stop offset="55%" stop-color="${c1}" />
        <stop offset="100%" stop-color="#0B0820" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#sky)" />
    ${stars.join('\n')}
    <!-- Silhouette study glyphs -->
    <g transform="translate(220, 260)">
      <circle cx="140" cy="140" r="130" fill="${c1}" fill-opacity="0.35" stroke="${c3}" stroke-width="5" />
      <polygon points="140,25 175,110 260,140 175,170 140,255 105,170 20,140 105,110" fill="${c2}" />
    </g>
    <g transform="translate(640, 260)">
      <rect x="10" y="10" width="260" height="260" rx="44" fill="${c0}" fill-opacity="0.65" stroke="${c2}" stroke-width="5" />
      <path d="M140 40 L175 180 L140 235 L105 180 Z" fill="${c3}" stroke="#0B0820" stroke-width="6" />
    </g>
    <g transform="translate(1060, 260)">
      <polygon points="140,20 260,90 260,210 140,270 20,210 20,90" fill="${c1}" fill-opacity="0.45" stroke="${c3}" stroke-width="5" />
      <circle cx="140" cy="145" r="65" fill="${c2}" />
    </g>
    ${swatchRects}
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function synthesizeArtPng(opts: SynthArtOptions): Promise<Buffer> {
  const rng = mulberry32(opts.seed);
  const { width, height } = opts;

  if (opts.grayscale) {
    // VFX mask / particle texture on pure black
    const rings: string[] = [];
    const cx = width / 2;
    const cy = height / 2;
    const maxR = Math.min(width, height) * 0.44;
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2 + rng() * 0.25;
      const dist = maxR * (0.25 + rng() * 0.65);
      const px = (cx + Math.cos(angle) * dist).toFixed(1);
      const py = (cy + Math.sin(angle) * dist).toFixed(1);
      const pr = (8 + rng() * 24).toFixed(1);
      rings.push(`<circle cx="${px}" cy="${py}" r="${pr}" fill="#FFFFFF" opacity="${(0.25 + rng() * 0.55).toFixed(2)}" />`);
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <defs>
        <radialGradient id="vfxCore" cx="50%" cy="50%" r="48%">
          <stop offset="0%" stop-color="#FFFFFF" stop-opacity="1" />
          <stop offset="45%" stop-color="#CCCCCC" stop-opacity="0.7" />
          <stop offset="80%" stop-color="#444444" stop-opacity="0.2" />
          <stop offset="100%" stop-color="#000000" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect x="0" y="0" width="${width}" height="${height}" fill="#000000" />
      <circle cx="${cx}" cy="${cy}" r="${maxR}" fill="url(#vfxCore)" />
      <path d="M ${cx - maxR * 0.8} ${cy} Q ${cx} ${cy - maxR * 0.9} ${cx + maxR * 0.8} ${cy} Q ${cx} ${cy - maxR * 0.35} ${cx - maxR * 0.8} ${cy} Z" fill="#FFFFFF" opacity="0.92" />
      ${rings.join('\n')}
    </svg>`;
    return sharp(Buffer.from(svg)).grayscale().png().toBuffer();
  }

  const colors = extractHexColors(opts.prompt, opts.paletteFallback ?? [
    '#1B1446',
    '#7C3AED',
    '#F5C451',
    '#3CD3F0',
    '#FF6B5A',
  ]);
  const bg0 = colors[0] ?? '#1B1446';
  const bg1 = colors[1] ?? '#7C3AED';
  const acc0 = colors[2] ?? '#F5C451';
  const acc1 = colors[3] ?? '#3CD3F0';

  if (opts.tileable) {
    // Seamless tile: every shape wrapped across 9 periodic offsets (-1, 0, +1) in X and Y,
    // over a uniform base color so opposite edges match with near-zero seam difference.
    const elements: string[] = [];
    for (let i = 0; i < 28; i++) {
      const bx = Math.round(rng() * width);
      const by = Math.round(rng() * height);
      const rx = Math.round(28 + rng() * 72);
      const ry = Math.round(24 + rng() * 64);
      const col = i % 3 === 0 ? bg1 : i % 3 === 1 ? acc1 : acc0;
      const op = (0.18 + rng() * 0.28).toFixed(2);
      for (const ox of [-width, 0, width]) {
        for (const oy of [-height, 0, height]) {
          elements.push(
            `<ellipse cx="${bx + ox}" cy="${by + oy}" rx="${rx}" ry="${ry}" fill="${col}" opacity="${op}" />`,
          );
        }
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <rect x="0" y="0" width="${width}" height="${height}" fill="${bg0}" />
      ${elements.join('\n')}
    </svg>`;
    return sharp(Buffer.from(svg)).png().toBuffer();
  }

  // Concept art / splash art / thumbnail
  const stars: string[] = [];
  for (let i = 0; i < 55; i++) {
    const sx = Math.round(rng() * width);
    const sy = Math.round(rng() * height * 0.72);
    const sr = (1.2 + rng() * 3.8).toFixed(1);
    const col = i % 2 === 0 ? acc0 : acc1;
    stars.push(`<circle cx="${sx}" cy="${sy}" r="${sr}" fill="${col}" opacity="${(0.35 + rng() * 0.65).toFixed(2)}" />`);
  }

  const midY = Math.round(height * 0.68);
  const fgY = Math.round(height * 0.82);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stop-color="${bg0}" />
        <stop offset="65%" stop-color="${bg1}" />
        <stop offset="100%" stop-color="#0B0820" />
      </linearGradient>
      <radialGradient id="focalSun" cx="50%" cy="42%" r="38%">
        <stop offset="0%" stop-color="${acc0}" stop-opacity="0.95" />
        <stop offset="45%" stop-color="${acc1}" stop-opacity="0.45" />
        <stop offset="100%" stop-color="${bg1}" stop-opacity="0" />
      </radialGradient>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" fill="url(#bgGrad)" />
    <circle cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.42)}" r="${Math.round(Math.min(width, height) * 0.42)}" fill="url(#focalSun)" />
    ${stars.join('\n')}
    <!-- Celestial monolith / citadel silhouette -->
    <polygon points="${Math.round(width * 0.5)},${Math.round(height * 0.16)} ${Math.round(width * 0.56)},${midY} ${Math.round(width * 0.44)},${midY}" fill="${acc0}" opacity="0.88" />
    <polygon points="0,${midY} ${Math.round(width * 0.25)},${Math.round(height * 0.48)} ${Math.round(width * 0.48)},${midY} ${Math.round(width * 0.74)},${Math.round(height * 0.45)} ${width},${midY} ${width},${height} 0,${height}" fill="${bg0}" opacity="0.9" />
    <polygon points="0,${fgY} ${Math.round(width * 0.35)},${Math.round(height * 0.66)} ${Math.round(width * 0.65)},${fgY} ${width},${Math.round(height * 0.62)} ${width},${height} 0,${height}" fill="#0B0820" />
  </svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

export async function synthesizeSpritesheetPng(opts: SynthSpritesheetOptions): Promise<{
  sheetPng: Buffer;
  rows: number;
  width: number;
  height: number;
}> {
  const rng = mulberry32(opts.seed);
  const cols = Math.max(1, opts.columns);
  const rows = Math.max(1, Math.ceil(opts.frameCount / cols));
  const cell = opts.frameSize;
  const width = cols * cell;
  const height = rows * cell;

  const colors = extractHexColors(opts.prompt, opts.paletteFallback ?? [
    '#F5C451',
    '#3CD3F0',
    '#7C3AED',
    '#FF6B5A',
  ]);
  const c0 = colors[0] ?? '#F5C451';
  const c1 = colors[1] ?? '#3CD3F0';
  const c2 = colors[2] ?? '#7C3AED';

  const cells: string[] = [];
  for (let idx = 0; idx < opts.frameCount; idx++) {
    const r = Math.floor(idx / cols);
    const c = idx % cols;
    const cx = c * cell + cell / 2;
    const cy = r * cell + cell / 2;
    const t = opts.frameCount > 1 ? idx / (opts.frameCount - 1) : 0;
    const angle = Math.round(t * 360);
    const scale = (0.45 + 0.45 * Math.sin(t * Math.PI)).toFixed(3);
    const outerR = Math.round(cell * 0.34);
    const innerR = Math.round(cell * 0.16);
    const sparkDist = Math.round(cell * (0.2 + 0.22 * t) + rng() * 4);

    cells.push(`
      <g transform="translate(${cx},${cy}) rotate(${angle}) scale(${scale})">
        <circle cx="0" cy="0" r="${outerR}" fill="${c2}" opacity="0.45" />
        <polygon points="0,-${outerR} ${innerR},-${innerR} ${outerR},0 ${innerR},${innerR} 0,${outerR} -${innerR},${innerR} -${outerR},0 -${innerR},-${innerR}" fill="${c0}" stroke="${c1}" stroke-width="4" />
        <circle cx="0" cy="-${sparkDist}" r="6" fill="#FFFFFF" />
        <circle cx="${sparkDist}" cy="0" r="6" fill="${c1}" />
        <circle cx="0" cy="${sparkDist}" r="6" fill="#FFFFFF" />
        <circle cx="-${sparkDist}" cy="0" r="6" fill="${c1}" />
      </g>
    `);
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
    ${cells.join('\n')}
  </svg>`;

  const sheetPng = await sharp(Buffer.from(svg)).png().toBuffer();
  return { sheetPng, rows, width, height };
}
