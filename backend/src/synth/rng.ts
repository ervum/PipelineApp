/**
 * Deterministic 32-bit PRNG (Mulberry32). Returns floats in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashStringToSeed(input: string, baseSeed = 20261022): number {
  let h = baseSeed >>> 0;
  for (let i = 0; i < input.length; i++) {
    h = Math.imul(h ^ input.charCodeAt(i), 16777619) >>> 0;
  }
  return h & 0x7fffffff;
}

export function extractHexColors(text: string, fallbacks: string[] = []): string[] {
  const regex = /#[0-9A-Fa-f]{6}\b/g;
  const found: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = regex.exec(text)) !== null) {
    const up = m[0].toUpperCase();
    if (!found.includes(up)) {
      found.push(up);
    }
  }
  for (const fb of fallbacks) {
    const up = fb.toUpperCase();
    if (!found.includes(up)) {
      found.push(up);
    }
  }
  return found;
}

export function hexToRgbNormalized(hex: string): [number, number, number] {
  const clean = hex.replace(/^#/, '');
  if (clean.length !== 6) return [0.486, 0.227, 0.929];
  const r = Number.parseInt(clean.slice(0, 2), 16) / 255;
  const g = Number.parseInt(clean.slice(2, 4), 16) / 255;
  const b = Number.parseInt(clean.slice(4, 6), 16) / 255;
  return [
    Number.isFinite(r) ? r : 0.5,
    Number.isFinite(g) ? g : 0.5,
    Number.isFinite(b) ? b : 0.5,
  ];
}
