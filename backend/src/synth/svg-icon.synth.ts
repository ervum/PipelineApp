import sharp from 'sharp';
import { extractHexColors, mulberry32 } from './rng';

export interface SynthIconOptions {
  prompt: string;
  seed: number;
  size?: 512 | 1024;
  frameShape?: 'NONE' | 'CIRCLE' | 'ROUNDED_SQUARE' | 'HEXAGON' | 'SHIELD' | 'DIAMOND';
  iconCategory?: 'ITEM' | 'SKILL' | 'RANK_EMBLEM' | 'UI_BUTTON';
  removeBackground?: boolean;
  solidBackgroundHex?: string | null;
  paletteFallback?: string[];
}

type GlyphKind = 'sword' | 'shield' | 'potion' | 'gem' | 'star' | 'flame' | 'crown';

function pickGlyphKind(prompt: string, rng: () => number): GlyphKind {
  const p = prompt.toLowerCase();
  if (/(katana|sword|blade|dagger|saber|slash)/.test(p)) return 'sword';
  if (/(shield|aegis|crest|ward|guard)/.test(p)) return 'shield';
  if (/(potion|elixir|flask|vial|brew)/.test(p)) return 'potion';
  if (/(crown|sss|sun|sovereign|awakened)/.test(p)) return 'crown';
  if (/(flame|fire|ember|pyre|burn)/.test(p)) return 'flame';
  if (/(star|comet|sigil|astral|nebula|rank)/.test(p)) return 'star';
  if (/(gem|crystal|relic|orb|stone)/.test(p)) return 'gem';
  const all: GlyphKind[] = ['sword', 'shield', 'potion', 'gem', 'star', 'flame', 'crown'];
  return all[Math.floor(rng() * all.length)] ?? 'star';
}

function renderFramePath(
  frameShape: NonNullable<SynthIconOptions['frameShape']>,
  c1: string,
  c2: string,
  outlineHex: string,
): string {
  switch (frameShape) {
    case 'CIRCLE':
      return `<circle cx="512" cy="512" r="430" fill="url(#frameGrad)" stroke="${outlineHex}" stroke-width="18" />
              <circle cx="512" cy="512" r="396" fill="none" stroke="${c2}" stroke-width="6" stroke-opacity="0.75" />`;
    case 'ROUNDED_SQUARE':
      return `<rect x="92" y="92" width="840" height="840" rx="140" fill="url(#frameGrad)" stroke="${outlineHex}" stroke-width="18" />
              <rect x="124" y="124" width="776" height="776" rx="112" fill="none" stroke="${c2}" stroke-width="6" stroke-opacity="0.75" />`;
    case 'HEXAGON':
      return `<polygon points="512,68 896,290 896,734 512,956 128,734 128,290" fill="url(#frameGrad)" stroke="${outlineHex}" stroke-width="18" />
              <polygon points="512,108 860,310 860,714 512,916 164,714 164,310" fill="none" stroke="${c2}" stroke-width="6" stroke-opacity="0.8" />`;
    case 'SHIELD':
      return `<path d="M512 76 L880 200 L840 590 C810 770 670 895 512 956 C354 895 214 770 184 590 L144 200 Z" fill="url(#frameGrad)" stroke="${outlineHex}" stroke-width="18" />
              <path d="M512 118 L836 226 L802 575 C776 734 652 848 512 908 C372 848 248 734 222 575 L188 226 Z" fill="none" stroke="${c2}" stroke-width="6" stroke-opacity="0.8" />`;
    case 'DIAMOND':
      return `<polygon points="512,64 960,512 512,960 64,512" fill="url(#frameGrad)" stroke="${outlineHex}" stroke-width="18" />
              <polygon points="512,114 910,512 512,910 114,512" fill="none" stroke="${c2}" stroke-width="6" stroke-opacity="0.8" />`;
    case 'NONE':
    default:
      return `<circle cx="512" cy="512" r="370" fill="url(#glowGrad)" opacity="0.55" />`;
  }
}

function renderGlyphSvg(
  glyph: GlyphKind,
  primary: string,
  secondary: string,
  accent: string,
  rim: string,
  outline: string,
): string {
  switch (glyph) {
    case 'sword':
      return `
        <g transform="translate(512,512) rotate(35) translate(-512,-512)">
          <!-- Outer shadow -->
          <path d="M512 110 L562 240 L546 660 L478 660 L462 240 Z" fill="#0B0820" opacity="0.45" transform="translate(12,16)" />
          <!-- Blade -->
          <path d="M512 104 L564 236 L544 662 L480 662 L460 236 Z" fill="url(#glyphMain)" stroke="${outline}" stroke-width="14" stroke-linejoin="round" />
          <!-- Fuller & Rim highlight -->
          <path d="M512 126 L534 244 L524 646 L512 646 Z" fill="${rim}" opacity="0.85" />
          <line x1="512" y1="150" x2="512" y2="635" stroke="${accent}" stroke-width="8" stroke-linecap="round" />
          <!-- Crossguard (crescent) -->
          <path d="M350 640 Q512 710 674 640 L648 698 Q512 748 376 698 Z" fill="${accent}" stroke="${outline}" stroke-width="14" stroke-linejoin="round" />
          <!-- Core Gem -->
          <polygon points="512,626 548,668 512,710 476,668" fill="${rim}" stroke="${outline}" stroke-width="10" />
          <!-- Grip -->
          <rect x="488" y="702" width="48" height="148" rx="14" fill="${secondary}" stroke="${outline}" stroke-width="12" />
          <!-- Pommel Star -->
          <polygon points="512,832 546,868 512,914 478,868" fill="${accent}" stroke="${outline}" stroke-width="12" />
        </g>`;
    case 'shield':
      return `
        <g>
          <path d="M512 170 L810 278 L774 585 C748 738 636 846 512 900 C388 846 276 738 250 585 L214 278 Z" fill="url(#glyphMain)" stroke="${outline}" stroke-width="16" stroke-linejoin="round" />
          <path d="M512 220 L752 308 L724 565 C702 692 610 785 512 832 C414 785 322 692 300 565 L272 308 Z" fill="${secondary}" stroke="${accent}" stroke-width="10" />
          <polygon points="512,310 560,448 698,448 586,530 628,668 512,584 396,668 438,530 326,448 464,448" fill="${accent}" stroke="${outline}" stroke-width="10" />
          <circle cx="512" cy="508" r="46" fill="${rim}" />
        </g>`;
    case 'potion':
      return `
        <g>
          <rect x="456" y="160" width="112" height="64" rx="16" fill="${accent}" stroke="${outline}" stroke-width="14" />
          <rect x="472" y="224" width="80" height="86" fill="${secondary}" stroke="${outline}" stroke-width="14" />
          <path d="M472 310 C310 380 240 530 270 695 C295 820 395 888 512 888 C629 888 729 820 754 695 C784 530 714 380 552 310 Z" fill="url(#glyphMain)" stroke="${outline}" stroke-width="16" />
          <path d="M300 610 Q512 565 724 610 C742 752 642 856 512 856 C382 856 282 752 300 610 Z" fill="${rim}" opacity="0.82" />
          <polygon points="512,480 538,540 598,566 538,592 512,652 486,592 426,566 486,540" fill="${accent}" />
        </g>`;
    case 'crown':
      return `
        <g>
          <polygon points="512,130 572,330 770,220 680,430 890,480 685,575 790,775 580,690 512,890 444,690 234,775 339,575 134,480 344,430 254,220 452,330" fill="${accent}" opacity="0.85" stroke="${outline}" stroke-width="12" />
          <path d="M240 660 L290 360 L420 490 L512 290 L604 490 L734 360 L784 660 Z" fill="url(#glyphMain)" stroke="${outline}" stroke-width="16" stroke-linejoin="round" />
          <rect x="240" y="660" width="544" height="76" rx="20" fill="${accent}" stroke="${outline}" stroke-width="16" />
          <circle cx="512" cy="490" r="44" fill="${rim}" stroke="${outline}" stroke-width="10" />
          <circle cx="360" cy="545" r="28" fill="${primary}" stroke="${outline}" stroke-width="8" />
          <circle cx="664" cy="545" r="28" fill="${primary}" stroke="${outline}" stroke-width="8" />
        </g>`;
    case 'flame':
      return `
        <g>
          <path d="M512 130 C640 280 790 430 760 650 C736 815 624 900 512 900 C400 900 288 815 264 650 C240 490 350 370 410 270 C405 365 455 410 512 130 Z" fill="url(#glyphMain)" stroke="${outline}" stroke-width="16" stroke-linejoin="round" />
          <path d="M512 320 C595 430 670 535 650 685 C634 795 575 855 512 855 C449 855 390 795 374 685 C354 535 429 430 512 320 Z" fill="${accent}" opacity="0.9" />
          <circle cx="512" cy="700" r="88" fill="${rim}" opacity="0.9" />
        </g>`;
    case 'gem':
      return `
        <g>
          <polygon points="512,140 770,330 690,780 512,890 334,780 254,330" fill="url(#glyphMain)" stroke="${outline}" stroke-width="16" stroke-linejoin="round" />
          <polygon points="512,220 690,360 630,720 512,800 394,720 334,360" fill="${rim}" opacity="0.55" />
          <polyline points="254,330 512,440 770,330" fill="none" stroke="${accent}" stroke-width="12" />
          <line x1="512" y1="140" x2="512" y2="890" stroke="#FFFFFF" stroke-width="8" stroke-opacity="0.7" />
        </g>`;
    case 'star':
    default:
      return `
        <g>
          <polygon points="512,132 612,382 882,412 672,588 736,852 512,708 288,852 352,588 142,412 412,382" fill="url(#glyphMain)" stroke="${outline}" stroke-width="16" stroke-linejoin="round" />
          <polygon points="512,240 576,418 764,438 620,558 664,740 512,640 360,740 404,558 260,438 448,418" fill="${accent}" opacity="0.88" />
          <circle cx="512" cy="516" r="76" fill="${rim}" stroke="${outline}" stroke-width="10" />
        </g>`;
  }
}

export async function synthesizeIconPng(opts: SynthIconOptions): Promise<Buffer> {
  const rng = mulberry32(opts.seed);
  const size = opts.size ?? 1024;
  const frameShape = opts.frameShape ?? 'NONE';
  const removeBackground = opts.removeBackground ?? true;
  const colors = extractHexColors(opts.prompt, opts.paletteFallback ?? [
    '#7C3AED',
    '#F5C451',
    '#3CD3F0',
    '#1B1446',
    '#FF6B5A',
  ]);

  const primary = colors[0] ?? '#7C3AED';
  const accent = colors[1] ?? '#F5C451';
  const rim = colors[2] ?? '#3CD3F0';
  const secondary = colors[3] ?? '#1B1446';
  const outline = '#0B0820';

  const glyph = pickGlyphKind(opts.prompt, rng);

  const sparkles: string[] = [];
  for (let i = 0; i < 8; i++) {
    const sx = Math.round(180 + rng() * 664);
    const sy = Math.round(160 + rng() * 680);
    const sr = Math.round(8 + rng() * 14);
    const col = i % 2 === 0 ? accent : rim;
    sparkles.push(
      `<polygon points="${sx},${sy - sr * 2} ${sx + sr * 0.6},${sy - sr * 0.6} ${sx + sr * 2},${sy} ${sx + sr * 0.6},${sy + sr * 0.6} ${sx},${sy + sr * 2} ${sx - sr * 0.6},${sy + sr * 0.6} ${sx - sr * 2},${sy} ${sx - sr * 0.6},${sy - sr * 0.6}" fill="${col}" opacity="0.88" />`,
    );
  }

  const bgRect = !removeBackground
    ? `<rect x="0" y="0" width="1024" height="1024" fill="${opts.solidBackgroundHex ?? secondary}" />`
    : '';

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="${size}" height="${size}">
    <defs>
      <linearGradient id="frameGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${secondary}" />
        <stop offset="100%" stop-color="${primary}" />
      </linearGradient>
      <radialGradient id="glowGrad" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${accent}" stop-opacity="0.85" />
        <stop offset="60%" stop-color="${primary}" stop-opacity="0.35" />
        <stop offset="100%" stop-color="${secondary}" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="glyphMain" x1="15%" y1="10%" x2="85%" y2="90%">
        <stop offset="0%" stop-color="${rim}" />
        <stop offset="50%" stop-color="${primary}" />
        <stop offset="100%" stop-color="${accent}" />
      </linearGradient>
    </defs>
    ${bgRect}
    ${renderFramePath(frameShape, primary, accent, outline)}
    ${renderGlyphSvg(glyph, primary, secondary, accent, rim, outline)}
    ${sparkles.join('\n')}
  </svg>`;

  return sharp(Buffer.from(svg)).resize(size, size).png().toBuffer();
}
