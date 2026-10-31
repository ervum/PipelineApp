import sharp from 'sharp';
import { synthesizeGlbMesh } from '../../src/synth/glb-mesh.synth';
import { synthesizeSfx } from '../../src/synth/wav-audio.synth';

/**
 * Deterministic media fixtures for post-processor and ingestion tests (Phases 0-2).
 */
export async function createRingIconWithIslandPng(size = 128): Promise<Buffer> {
  const cx = size / 2;
  const cy = size / 2;
  const outerR = size * 0.36;
  const innerR = size * 0.16;
  const bg = { r: 20, g: 14, b: 54 }; // #140E36 key background
  const ring = { r: 245, g: 196, b: 81 }; // #F5C451 gold ring

  const rgba = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const idx = (y * size + x) * 4;
      if (dist <= outerR && dist >= innerR) {
        rgba[idx] = ring.r;
        rgba[idx + 1] = ring.g;
        rgba[idx + 2] = ring.b;
        rgba[idx + 3] = 255;
      } else {
        // Both outer border and enclosed inner hole use the background key color
        rgba[idx] = bg.r;
        rgba[idx + 1] = bg.g;
        rgba[idx + 2] = bg.b;
        rgba[idx + 3] = 255;
      }
    }
  }

  return sharp(rgba, { raw: { width: size, height: size, channels: 4 } })
    .png()
    .toBuffer();
}

export async function createSeamedTilePng(size = 64): Promise<Buffer> {
  const rgb = Buffer.alloc(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 3;
      // Intentional left-to-right and top-to-bottom gradient discontinuity
      rgb[idx] = Math.round((x / (size - 1)) * 220);
      rgb[idx + 1] = Math.round((y / (size - 1)) * 180);
      rgb[idx + 2] = 90;
    }
  }
  return sharp(rgb, { raw: { width: size, height: size, channels: 3 } })
    .png()
    .toBuffer();
}

export function createSampleWavBuffer(durationSec = 1.0): Buffer {
  return synthesizeSfx({
    category: 'WEAPON_HIT',
    seed: 42,
    durationSec,
    sampleRate: 22050,
  }).wav;
}

export function createSampleGlbBuffer(): Buffer {
  return synthesizeGlbMesh({
    prompt: 'Crystal greatsword #7C3AED',
    seed: 101,
    category: 'WEAPON',
  }).glb;
}

export function createSampleObjBuffer(): Buffer {
  const objText = [
    '# Sample pyramid mesh',
    'mtllib pyramid.mtl',
    'v -1.0 0.0 -1.0',
    'v  1.0 0.0 -1.0',
    'v  1.0 0.0  1.0',
    'v -1.0 0.0  1.0',
    'v  0.0 2.0  0.0',
    'f 1 2 3 4',
    'f 1 2 5',
    'f 2 3 5',
    'f 3 4 5',
    'f 4 1 5',
  ].join('\n');
  return Buffer.from(objText, 'utf8');
}
