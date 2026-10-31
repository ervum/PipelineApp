export type IconFrameShape =
  | 'NONE'
  | 'CIRCLE'
  | 'ROUNDED_SQUARE'
  | 'HEXAGON'
  | 'SHIELD'
  | 'DIAMOND';

export function buildFrameShapePath(
  shape: IconFrameShape,
  width: number,
  height: number,
  inset = 0,
): string {
  const w = width;
  const h = height;
  const pad = Math.max(0, inset);
  const cx = w / 2;
  const cy = h / 2;
  const rx = Math.max(4, w / 2 - pad);
  const ry = Math.max(4, h / 2 - pad);

  switch (shape) {
    case 'CIRCLE':
      return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" />`;

    case 'ROUNDED_SQUARE': {
      const r = Math.round(Math.min(w, h) * 0.18);
      return `<rect x="${pad}" y="${pad}" width="${w - pad * 2}" height="${h - pad * 2}" rx="${r}" ry="${r}" />`;
    }

    case 'HEXAGON': {
      const pts: string[] = [];
      for (let i = 0; i < 6; i++) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const px = (cx + rx * Math.cos(angle)).toFixed(2);
        const py = (cy + ry * Math.sin(angle)).toFixed(2);
        pts.push(`${px},${py}`);
      }
      return `<polygon points="${pts.join(' ')}" />`;
    }

    case 'DIAMOND': {
      const pts = [
        `${cx},${pad}`,
        `${w - pad},${cy}`,
        `${cx},${h - pad}`,
        `${pad},${cy}`,
      ].join(' ');
      return `<polygon points="${pts}" />`;
    }

    case 'SHIELD': {
      const top = pad;
      const left = pad + w * 0.06;
      const right = w - pad - w * 0.06;
      const midY = top + (h - pad * 2) * 0.52;
      const botY = h - pad;
      const d = [
        `M ${cx} ${top}`,
        `L ${right} ${top + (h - pad * 2) * 0.12}`,
        `L ${right} ${midY}`,
        `Q ${right} ${botY - (h - pad * 2) * 0.16} ${cx} ${botY}`,
        `Q ${left} ${botY - (h - pad * 2) * 0.16} ${left} ${midY}`,
        `L ${left} ${top + (h - pad * 2) * 0.12}`,
        'Z',
      ].join(' ');
      return `<path d="${d}" />`;
    }

    default:
      return `<rect x="0" y="0" width="${w}" height="${h}" />`;
  }
}

export function buildFrameMaskSvg(
  shape: IconFrameShape,
  width: number,
  height: number,
): Buffer {
  const el = buildFrameShapePath(shape, width, height, Math.round(Math.min(width, height) * 0.02));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${el.replace('/>', ' fill="#ffffff" />')}</svg>`;
  return Buffer.from(svg, 'utf8');
}

export function buildFrameStrokeSvg(
  shape: IconFrameShape,
  width: number,
  height: number,
  strokeHex: string,
): Buffer {
  const strokeWidth = Math.max(2, Math.round(Math.min(width, height) * 0.025));
  const inset = Math.round(Math.min(width, height) * 0.02) + Math.ceil(strokeWidth / 2);
  const el = buildFrameShapePath(shape, width, height, inset);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${el.replace('/>', ` fill="none" stroke="${strokeHex}" stroke-width="${strokeWidth}" stroke-linejoin="round" />`)}</svg>`;
  return Buffer.from(svg, 'utf8');
}
