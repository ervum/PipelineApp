const EXT_TO_MIME: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  glb: 'model/gltf-binary',
  gltf: 'model/gltf+json',
  fbx: 'application/octet-stream',
  obj: 'text/plain',
  md: 'text/markdown; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  json: 'application/json; charset=utf-8',
  lua: 'text/x-lua; charset=utf-8',
  luau: 'text/x-luau; charset=utf-8',
  gd: 'text/x-gdscript; charset=utf-8',
  gdshader: 'text/plain; charset=utf-8',
  hlsl: 'text/plain; charset=utf-8',
  glsl: 'text/plain; charset=utf-8',
};

const MIME_TO_EXT: Readonly<Record<string, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/svg+xml': 'svg',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/wave': 'wav',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'model/gltf-binary': 'glb',
  'model/gltf+json': 'gltf',
  'text/markdown': 'md',
  'text/plain': 'txt',
  'application/json': 'json',
};

export function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx < 0 || idx === filename.length - 1) return '';
  return filename.slice(idx + 1).toLowerCase();
}

export function mimeFromFilename(filename: string, fallback = 'application/octet-stream'): string {
  const ext = extensionOf(filename);
  return EXT_TO_MIME[ext] ?? fallback;
}

export function extensionFromMime(mimeType: string, fallback = 'bin'): string {
  const base = (mimeType.split(';')[0] ?? '').trim().toLowerCase();
  return MIME_TO_EXT[base] ?? fallback;
}

export const extensionForMime = extensionFromMime;

export function mimeForExtension(
  ext: string,
  fallback = 'application/octet-stream',
): string {
  return EXT_TO_MIME[ext.toLowerCase().replace(/^\./, '')] ?? fallback;
}

export function sniffMimeFromBuffer(
  buf: Buffer,
  fallback = 'application/octet-stream',
): string {
  if (buf.length >= 8) {
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47
    ) {
      return 'image/png';
    }
    // JPEG: FF D8 FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      return 'image/jpeg';
    }
    // GIF: GIF87a or GIF89a
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
      return 'image/gif';
    }
    // RIFF (WEBP or WAVE)
    if (
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf.length >= 12
    ) {
      const sub = buf.subarray(8, 12).toString('ascii');
      if (sub === 'WEBP') return 'image/webp';
      if (sub === 'WAVE') return 'audio/wav';
    }
    // OGG: OggS
    if (buf[0] === 0x4f && buf[1] === 0x67 && buf[2] === 0x67 && buf[3] === 0x53) {
      return 'audio/ogg';
    }
    // GLB: magic "glTF" (0x46546C67 LE = 67 6C 54 46)
    if (buf[0] === 0x67 && buf[1] === 0x6c && buf[2] === 0x54 && buf[3] === 0x46) {
      return 'model/gltf-binary';
    }
    // MP3: ID3 or MPEG sync word
    if (
      (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) ||
      (buf[0] === 0xff && (buf[1]! & 0xe0) === 0xe0)
    ) {
      return 'audio/mpeg';
    }
  }
  return fallback;
}
