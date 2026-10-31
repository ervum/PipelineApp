import sharp from 'sharp';
import { VIDEO_ASPECT_DIMENSIONS } from '@forge/shared';
import { extractHexColors, mulberry32 } from './rng';

export interface SynthVideoOptions {
  prompt: string;
  seed: number;
  aspectRatio?: '16:9' | '9:16' | '1:1' | '21:9';
  resolution?: '720p' | '1080p';
  durationSec?: number;
  fps?: 24 | 30 | 60;
  videoCategory?: string;
  cameraMotion?: string;
  motionIntensity?: number;
  loopable?: boolean;
  hasAudio?: boolean;
  memoryStrategy?: string;
  paletteFallback?: string[];
}

export interface SynthVideoResult {
  animatedWebp: Buffer;
  posterPng: Buffer;
  frames: Buffer[];
  width: number;
  height: number;
  durationMs: number;
  fps: number;
  frameCount: number;
}

export async function synthesizeVideo(opts: SynthVideoOptions): Promise<SynthVideoResult> {
  const rng = mulberry32(opts.seed);
  const aspectRatio = opts.aspectRatio ?? '16:9';
  const baseDims = VIDEO_ASPECT_DIMENSIONS[aspectRatio] ?? VIDEO_ASPECT_DIMENSIONS['16:9'];
  // Use half-res for fast offline frame synthesis while recording full target dimensions
  const width = Math.round(baseDims.width / 2);
  const height = Math.round(baseDims.height / 2);
  const durationSec = Math.max(2, Math.min(16, opts.durationSec ?? 5));
  const fps = opts.fps ?? 24;
  const durationMs = Math.round(durationSec * 1000);
  const cameraMotion = opts.cameraMotion ?? 'STATIC';
  const motionIntensity = Math.max(0, Math.min(1, opts.motionIntensity ?? 0.5));
  const videoCategory = opts.videoCategory ?? 'CUTSCENE';

  const colors = extractHexColors(opts.prompt, opts.paletteFallback ?? [
    '#140E36',
    '#6D28D9',
    '#38BDF8',
    '#F59E0B',
    '#F43F5E',
  ]);
  const cBg = colors[0] ?? '#140E36';
  const cPrimary = colors[1] ?? '#6D28D9';
  const cAccent = colors[2] ?? '#38BDF8';
  const cGold = colors[3] ?? '#F59E0B';

  const starCoords = Array.from({ length: 28 }, () => ({
    x: rng() * width,
    y: rng() * height * 0.72,
    r: 1.2 + rng() * 2.6,
    phase: rng() * Math.PI * 2,
  }));

  const keyframeCount = 8;
  const frames: Buffer[] = [];

  for (let f = 0; f < keyframeCount; f++) {
    const t = opts.loopable
      ? Math.sin((f / keyframeCount) * Math.PI * 2) * 0.5 + 0.5
      : f / Math.max(1, keyframeCount - 1);
    const angle = (f / keyframeCount) * Math.PI * 2;

    let camDx = 0;
    let camDy = 0;
    let camScale = 1;
    const amp = 45 * (0.35 + motionIntensity * 0.9);

    switch (cameraMotion) {
      case 'PAN_LEFT':
        camDx = (0.5 - t) * amp * 1.6;
        break;
      case 'PAN_RIGHT':
        camDx = (t - 0.5) * amp * 1.6;
        break;
      case 'TILT_UP':
        camDy = (0.5 - t) * amp * 1.3;
        break;
      case 'TILT_DOWN':
        camDy = (t - 0.5) * amp * 1.3;
        break;
      case 'ZOOM_IN':
        camScale = 1 + t * 0.28 * (0.4 + motionIntensity);
        break;
      case 'ZOOM_OUT':
        camScale = 1.28 - t * 0.25 * (0.4 + motionIntensity);
        break;
      case 'ORBIT':
        camDx = Math.cos(angle) * amp;
        camDy = Math.sin(angle) * (amp * 0.45);
        break;
      case 'DOLLY_TRACK':
        camDx = (t - 0.5) * amp * 1.2;
        camScale = 1 + Math.sin(t * Math.PI) * 0.14;
        break;
      default:
        camDx = Math.sin(angle) * 6;
        break;
    }

    const cx = width / 2 + camDx;
    const cy = height / 2 + camDy;
    const coreRadius = Math.min(width, height) * 0.18 * camScale;
    const ringRadius = coreRadius * (1.45 + 0.12 * Math.sin(angle));

    const starsSvg = starCoords
      .map((st, idx) => {
        const sx = ((st.x + camDx * 0.35 + width) % width).toFixed(1);
        const sy = ((st.y + camDy * 0.25 + height) % height).toFixed(1);
        const op = (0.35 + 0.55 * (0.5 + 0.5 * Math.sin(angle + st.phase))).toFixed(2);
        const fill = idx % 3 === 0 ? cGold : idx % 2 === 0 ? cAccent : '#FFFFFF';
        return `<circle cx="${sx}" cy="${sy}" r="${st.r.toFixed(1)}" fill="${fill}" opacity="${op}" />`;
      })
      .join('\n');

    const orbitX = (cx + Math.cos(angle) * ringRadius).toFixed(1);
    const orbitY = (cy + Math.sin(angle) * (ringRadius * 0.55)).toFixed(1);
    const orbitX2 = (cx + Math.cos(angle + Math.PI) * ringRadius * 0.85).toFixed(1);
    const orbitY2 = (cy + Math.sin(angle + Math.PI) * (ringRadius * 0.45)).toFixed(1);

    const timecodeSec = ((f / keyframeCount) * durationSec).toFixed(1);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
      <defs>
        <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="${cBg}" />
          <stop offset="55%" stop-color="${cPrimary}" stop-opacity="0.55" />
          <stop offset="100%" stop-color="#070510" />
        </linearGradient>
        <radialGradient id="coreGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="${cGold}" stop-opacity="0.95" />
          <stop offset="45%" stop-color="${cAccent}" stop-opacity="0.65" />
          <stop offset="100%" stop-color="${cPrimary}" stop-opacity="0" />
        </radialGradient>
      </defs>
      <rect width="${width}" height="${height}" fill="url(#bgGrad)" />
      ${starsSvg}
      <!-- Horizon Grid -->
      <path d="M 0 ${Math.round(height * 0.76)} L ${width} ${Math.round(height * 0.76)}" stroke="${cAccent}" stroke-opacity="0.35" stroke-width="1.5" />
      <g transform="translate(${cx.toFixed(1)}, ${cy.toFixed(1)}) scale(${camScale.toFixed(3)})">
        <circle cx="0" cy="0" r="${(coreRadius * 1.9).toFixed(1)}" fill="url(#coreGlow)" />
        <ellipse cx="0" cy="0" rx="${ringRadius.toFixed(1)}" ry="${(ringRadius * 0.48).toFixed(1)}" fill="none" stroke="${cAccent}" stroke-width="2.5" stroke-dasharray="10 6" transform="rotate(${Math.round((f / keyframeCount) * 180)})" />
        <polygon points="0,-${coreRadius.toFixed(1)} ${(coreRadius * 0.78).toFixed(1)},0 0,${coreRadius.toFixed(1)} -${(coreRadius * 0.78).toFixed(1)},0" fill="${cPrimary}" stroke="${cGold}" stroke-width="3" />
        <circle cx="0" cy="0" r="${(coreRadius * 0.36).toFixed(1)}" fill="${cGold}" />
      </g>
      <circle cx="${orbitX}" cy="${orbitY}" r="7" fill="${cAccent}" />
      <circle cx="${orbitX2}" cy="${orbitY2}" r="5" fill="${cGold}" />
      <!-- HUD Telemetry Overlay -->
      <rect x="14" y="14" width="220" height="28" rx="6" fill="#090714" fill-opacity="0.72" stroke="${cAccent}" stroke-opacity="0.35" stroke-width="1" />
      <text x="24" y="32" fill="#E2E8F0" font-family="monospace" font-size="12" font-weight="bold">${videoCategory} · ${cameraMotion} · ${timecodeSec}s</text>
    </svg>`;

    const framePng = await sharp(Buffer.from(svg)).png().toBuffer();
    frames.push(framePng);
  }

  const posterPng = frames[0]!;
  const animatedWebp = await sharp(posterPng).webp({ quality: 88 }).toBuffer();

  return {
    animatedWebp,
    posterPng,
    frames,
    width: baseDims.width,
    height: baseDims.height,
    durationMs,
    fps,
    frameCount: keyframeCount,
  };
}
