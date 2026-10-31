import { extractHexColors, hexToRgbNormalized, mulberry32 } from './rng';

export type MeshCategory = 'PROP' | 'WEAPON' | 'ENVIRONMENT' | 'CHARACTER_BASE';
export type MeshPose = 'NONE' | 'T_POSE' | 'A_POSE';

export interface SynthGlbOptions {
  prompt: string;
  seed: number;
  category?: MeshCategory;
  pose?: MeshPose;
  paletteFallback?: string[];
  metallicFactor?: number;
  roughnessFactor?: number;
}

export interface SynthGlbResult {
  glb: Buffer;
  vertexCount: number;
  triangleCount: number;
  boundingBox: [number, number, number];
}

export interface GlbInspectionResult {
  magic: number;
  version: number;
  totalLength: number;
  jsonChunkLength: number;
  jsonChunkType: number;
  binChunkLength: number;
  binChunkType: number;
  vertexCount: number;
  triangleCount: number;
  boundingBox: [number, number, number];
  gltf: Record<string, unknown>;
}

interface RawGeometry {
  positions: number[]; // flat [x,y,z, ...]
  indices: number[]; // flat triangle indices [i0,i1,i2, ...]
}

function appendBox(
  geo: RawGeometry,
  cx: number,
  cy: number,
  cz: number,
  sx: number,
  sy: number,
  sz: number,
  bevel = 0,
): void {
  const hx = sx / 2;
  const hy = sy / 2;
  const hz = sz / 2;
  const baseIdx = geo.positions.length / 3;

  const corners: Array<[number, number, number]> = [
    [-hx, -hy, -hz],
    [hx, -hy, -hz],
    [hx, hy, -hz],
    [-hx, hy, -hz],
    [-hx, -hy, hz],
    [hx, -hy, hz],
    [hx, hy, hz],
    [-hx, hy, hz],
  ];

  for (const [x, y, z] of corners) {
    const scale = bevel > 0 ? 1 - bevel * 0.08 : 1;
    geo.positions.push(cx + x * scale, cy + y * scale, cz + z * scale);
  }

  const faces: Array<[number, number, number, number]> = [
    [4, 5, 6, 7], // front (+Z)
    [1, 0, 3, 2], // back (-Z)
    [0, 4, 7, 3], // left (-X)
    [5, 1, 2, 6], // right (+X)
    [3, 7, 6, 2], // top (+Y)
    [0, 1, 5, 4], // bottom (-Y)
  ];

  for (const [a, b, c, d] of faces) {
    geo.indices.push(baseIdx + a, baseIdx + b, baseIdx + c);
    geo.indices.push(baseIdx + a, baseIdx + c, baseIdx + d);
  }
}

function appendCylinder(
  geo: RawGeometry,
  cx: number,
  cy: number,
  cz: number,
  radiusBottom: number,
  radiusTop: number,
  height: number,
  segments = 12,
): void {
  const baseIdx = geo.positions.length / 3;
  const y0 = cy - height / 2;
  const y1 = cy + height / 2;

  for (let i = 0; i < segments; i++) {
    const theta = (i / segments) * Math.PI * 2;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    geo.positions.push(cx + cos * radiusBottom, y0, cz + sin * radiusBottom);
    geo.positions.push(cx + cos * radiusTop, y1, cz + sin * radiusTop);
  }

  const bottomCenterIdx = geo.positions.length / 3;
  geo.positions.push(cx, y0, cz);
  const topCenterIdx = geo.positions.length / 3;
  geo.positions.push(cx, y1, cz);

  for (let i = 0; i < segments; i++) {
    const next = (i + 1) % segments;
    const b0 = baseIdx + i * 2;
    const t0 = baseIdx + i * 2 + 1;
    const b1 = baseIdx + next * 2;
    const t1 = baseIdx + next * 2 + 1;

    // Side quad
    geo.indices.push(b0, b1, t1);
    geo.indices.push(b0, t1, t0);
    // Caps
    geo.indices.push(bottomCenterIdx, b1, b0);
    geo.indices.push(topCenterIdx, t0, t1);
  }
}

function appendSphere(
  geo: RawGeometry,
  cx: number,
  cy: number,
  cz: number,
  radius: number,
  rings = 10,
  sectors = 14,
  noiseAmplitude = 0,
  rng?: () => number,
): void {
  const baseIdx = geo.positions.length / 3;

  for (let r = 0; r <= rings; r++) {
    const v = r / rings;
    const phi = v * Math.PI;
    for (let s = 0; s <= sectors; s++) {
      const u = s / sectors;
      const theta = u * Math.PI * 2;
      const nx = Math.sin(phi) * Math.cos(theta);
      const ny = Math.cos(phi);
      const nz = Math.sin(phi) * Math.sin(theta);
      const disp =
        noiseAmplitude > 0 && rng && s < sectors && r > 0 && r < rings
          ? 1 + (rng() - 0.5) * 2 * noiseAmplitude
          : 1;
      geo.positions.push(
        cx + nx * radius * disp,
        cy + ny * radius * disp,
        cz + nz * radius * disp,
      );
    }
  }

  const stride = sectors + 1;
  for (let r = 0; r < rings; r++) {
    for (let s = 0; s < sectors; s++) {
      const i0 = baseIdx + r * stride + s;
      const i1 = i0 + 1;
      const i2 = baseIdx + (r + 1) * stride + s;
      const i3 = i2 + 1;
      geo.indices.push(i0, i2, i1);
      geo.indices.push(i1, i2, i3);
    }
  }
}

function buildWeaponGeometry(rng: () => number): RawGeometry {
  const geo: RawGeometry = { positions: [], indices: [] };
  const curve = 0.08 + rng() * 0.06;

  // Extruded diamond-profile blade segments from y=0.2 to y=1.85
  const rings = 10;
  const baseIdx = geo.positions.length / 3;
  for (let i = 0; i <= rings; i++) {
    const t = i / rings;
    const y = 0.2 + t * 1.65;
    const taper = t < 0.85 ? 1 - t * 0.35 : Math.max(0.02, (1 - t) / 0.15);
    const halfWidth = 0.095 * taper;
    const halfThick = 0.028 * taper;
    const xOffset = Math.sin(t * Math.PI * 0.65) * curve;

    // 4 vertices per cross-section: +X (edge), +Z (ridge), -X (spine), -Z (ridge)
    geo.positions.push(xOffset + halfWidth, y, 0);
    geo.positions.push(xOffset, y, halfThick);
    geo.positions.push(xOffset - halfWidth, y, 0);
    geo.positions.push(xOffset, y, -halfThick);
  }

  for (let i = 0; i < rings; i++) {
    const r0 = baseIdx + i * 4;
    const r1 = baseIdx + (i + 1) * 4;
    for (let k = 0; k < 4; k++) {
      const kn = (k + 1) % 4;
      geo.indices.push(r0 + k, r0 + kn, r1 + kn);
      geo.indices.push(r0 + k, r1 + kn, r1 + k);
    }
  }

  // Tip cap
  const tipRing = baseIdx + rings * 4;
  geo.indices.push(tipRing, tipRing + 1, tipRing + 2);
  geo.indices.push(tipRing, tipRing + 2, tipRing + 3);

  // Crossguard
  appendBox(geo, 0, 0.18, 0, 0.42, 0.06, 0.12, 0.2);
  // Grip
  appendCylinder(geo, 0, -0.08, 0, 0.036, 0.042, 0.46, 12);
  // Pommel
  appendSphere(geo, 0, -0.35, 0, 0.065, 8, 10);

  return geo;
}

function buildPropGeometry(rng: () => number): RawGeometry {
  const geo: RawGeometry = { positions: [], indices: [] };
  // Beveled crate / anvil pedestal with recessed bands and top crystal
  appendBox(geo, 0, 0.42, 0, 0.88, 0.84, 0.88, 0.25);
  appendBox(geo, 0, 0.06, 0, 1.02, 0.12, 1.02, 0.1);
  appendBox(geo, 0, 0.82, 0, 0.96, 0.1, 0.96, 0.1);
  appendCylinder(geo, 0, 1.02, 0, 0.18 + rng() * 0.04, 0.04, 0.34, 8);
  return geo;
}

function buildEnvironmentGeometry(rng: () => number): RawGeometry {
  const geo: RawGeometry = { positions: [], indices: [] };
  appendSphere(geo, 0, 0.75, 0, 0.78, 12, 16, 0.18, rng);
  appendSphere(geo, 0.48, 0.35, 0.28, 0.36, 8, 10, 0.15, rng);
  appendSphere(geo, -0.44, 0.3, -0.22, 0.32, 8, 10, 0.15, rng);
  return geo;
}

function buildCharacterBaseGeometry(pose: MeshPose): RawGeometry {
  const geo: RawGeometry = { positions: [], indices: [] };
  // Head
  appendSphere(geo, 0, 1.62, 0, 0.14, 10, 12);
  // Torso
  appendCylinder(geo, 0, 1.15, 0, 0.15, 0.19, 0.62, 12);
  // Pelvis
  appendBox(geo, 0, 0.78, 0, 0.32, 0.16, 0.22, 0.2);
  // Legs
  appendCylinder(geo, -0.1, 0.38, 0, 0.065, 0.085, 0.72, 10);
  appendCylinder(geo, 0.1, 0.38, 0, 0.065, 0.085, 0.72, 10);

  // Arms in T-pose or A-pose
  const armY = pose === 'T_POSE' ? 1.38 : 1.24;
  const armSpan = pose === 'T_POSE' ? 0.48 : 0.38;
  appendBox(geo, -armSpan, armY, 0, 0.52, 0.09, 0.09, 0.1);
  appendBox(geo, armSpan, armY, 0, 0.52, 0.09, 0.09, 0.1);

  return geo;
}

function computeSmoothNormals(positions: number[], indices: number[]): Float32Array {
  const numVerts = positions.length / 3;
  const normals = new Float32Array(positions.length);

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i]! * 3;
    const i1 = indices[i + 1]! * 3;
    const i2 = indices[i + 2]! * 3;

    const ax = positions[i0] ?? 0;
    const ay = positions[i0 + 1] ?? 0;
    const az = positions[i0 + 2] ?? 0;

    const bx = positions[i1] ?? 0;
    const by = positions[i1 + 1] ?? 0;
    const bz = positions[i1 + 2] ?? 0;

    const cx = positions[i2] ?? 0;
    const cy = positions[i2 + 1] ?? 0;
    const cz = positions[i2 + 2] ?? 0;

    const ux = bx - ax;
    const uy = by - ay;
    const uz = bz - az;

    const vx = cx - ax;
    const vy = cy - ay;
    const vz = cz - az;

    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;

    for (const vBase of [i0, i1, i2]) {
      normals[vBase] = (normals[vBase] ?? 0) + nx;
      normals[vBase + 1] = (normals[vBase + 1] ?? 0) + ny;
      normals[vBase + 2] = (normals[vBase + 2] ?? 0) + nz;
    }
  }

  for (let v = 0; v < numVerts; v++) {
    const base = v * 3;
    const nx = normals[base] ?? 0;
    const ny = normals[base + 1] ?? 0;
    const nz = normals[base + 2] ?? 0;
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-6) {
      normals[base] = nx / len;
      normals[base + 1] = ny / len;
      normals[base + 2] = nz / len;
    } else {
      normals[base] = 0;
      normals[base + 1] = 1;
      normals[base + 2] = 0;
    }
  }

  return normals;
}

export function synthesizeGlbMesh(opts: SynthGlbOptions): SynthGlbResult {
  const rng = mulberry32(opts.seed);
  const category = opts.category ?? 'PROP';
  const pose = opts.pose ?? 'A_POSE';

  let geo: RawGeometry;
  switch (category) {
    case 'WEAPON':
      geo = buildWeaponGeometry(rng);
      break;
    case 'ENVIRONMENT':
      geo = buildEnvironmentGeometry(rng);
      break;
    case 'CHARACTER_BASE':
      geo = buildCharacterBaseGeometry(pose);
      break;
    case 'PROP':
    default:
      geo = buildPropGeometry(rng);
      break;
  }

  const vertexCount = geo.positions.length / 3;
  const triangleCount = geo.indices.length / 3;

  const posArray = new Float32Array(geo.positions);
  const normArray = computeSmoothNormals(geo.positions, geo.indices);

  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < posArray.length; i += 3) {
    const x = posArray[i]!;
    const y = posArray[i + 1]!;
    const z = posArray[i + 2]!;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  const useUint32 = vertexCount >= 65536;
  const indexArray = useUint32 ? new Uint32Array(geo.indices) : new Uint16Array(geo.indices);
  const indexComponentType = useUint32 ? 5125 : 5123;

  const posBytes = Buffer.from(posArray.buffer, posArray.byteOffset, posArray.byteLength);
  const normBytes = Buffer.from(normArray.buffer, normArray.byteOffset, normArray.byteLength);
  const idxBytesRaw = Buffer.from(indexArray.buffer, indexArray.byteOffset, indexArray.byteLength);

  // Align BIN sub-buffers to 4-byte boundaries
  const idxPad = (4 - (idxBytesRaw.length % 4)) % 4;
  const idxBytes =
    idxPad > 0 ? Buffer.concat([idxBytesRaw, Buffer.alloc(idxPad, 0)]) : idxBytesRaw;

  const posByteOffset = 0;
  const posByteLength = posBytes.length;

  const normByteOffset = posByteOffset + posByteLength;
  const normByteLength = normBytes.length;

  const idxByteOffset = normByteOffset + normByteLength;
  const idxByteLength = idxBytesRaw.length;

  const binPayload = Buffer.concat([posBytes, normBytes, idxBytes]);
  const binPad = (4 - (binPayload.length % 4)) % 4;
  const binChunkData =
    binPad > 0 ? Buffer.concat([binPayload, Buffer.alloc(binPad, 0)]) : binPayload;

  const colors = extractHexColors(opts.prompt, opts.paletteFallback ?? ['#7C3AED', '#F5C451']);
  const [r, g, b] = hexToRgbNormalized(colors[0] ?? '#7C3AED');

  const gltfJson = {
    asset: {
      version: '2.0',
      generator: 'ForgeStudio Control Room GLB Synth v1',
    },
    scene: 0,
    scenes: [{ name: 'Scene', nodes: [0] }],
    nodes: [{ name: `Forge_${category}`, mesh: 0 }],
    materials: [
      {
        name: 'ForgePbrMaterial',
        pbrMetallicRoughness: {
          baseColorFactor: [
            Number(r.toFixed(4)),
            Number(g.toFixed(4)),
            Number(b.toFixed(4)),
            1.0,
          ],
          metallicFactor: opts.metallicFactor ?? (category === 'WEAPON' ? 0.82 : 0.35),
          roughnessFactor: opts.roughnessFactor ?? (category === 'WEAPON' ? 0.24 : 0.55),
        },
      },
    ],
    meshes: [
      {
        name: `Mesh_${category}`,
        primitives: [
          {
            attributes: {
              POSITION: 0,
              NORMAL: 1,
            },
            indices: 2,
            material: 0,
            mode: 4,
          },
        ],
      },
    ],
    accessors: [
      {
        bufferView: 0,
        byteOffset: 0,
        componentType: 5126,
        count: vertexCount,
        type: 'VEC3',
        min: [Number(minX.toFixed(5)), Number(minY.toFixed(5)), Number(minZ.toFixed(5))],
        max: [Number(maxX.toFixed(5)), Number(maxY.toFixed(5)), Number(maxZ.toFixed(5))],
      },
      {
        bufferView: 1,
        byteOffset: 0,
        componentType: 5126,
        count: vertexCount,
        type: 'VEC3',
      },
      {
        bufferView: 2,
        byteOffset: 0,
        componentType: indexComponentType,
        count: geo.indices.length,
        type: 'SCALAR',
      },
    ],
    bufferViews: [
      {
        buffer: 0,
        byteOffset: posByteOffset,
        byteLength: posByteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: normByteOffset,
        byteLength: normByteLength,
        target: 34962,
      },
      {
        buffer: 0,
        byteOffset: idxByteOffset,
        byteLength: idxByteLength,
        target: 34963,
      },
    ],
    buffers: [
      {
        byteLength: binChunkData.length,
      },
    ],
  };

  const jsonRaw = Buffer.from(JSON.stringify(gltfJson), 'utf8');
  const jsonPad = (4 - (jsonRaw.length % 4)) % 4;
  const jsonChunkData =
    jsonPad > 0 ? Buffer.concat([jsonRaw, Buffer.alloc(jsonPad, 0x20)]) : jsonRaw;

  const totalLength = 12 + 8 + jsonChunkData.length + 8 + binChunkData.length;
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0); // "glTF"
  header.writeUInt32LE(2, 4); // version 2
  header.writeUInt32LE(totalLength, 8);

  const jsonChunkHeader = Buffer.alloc(8);
  jsonChunkHeader.writeUInt32LE(jsonChunkData.length, 0);
  jsonChunkHeader.writeUInt32LE(0x4e4f534a, 4); // "JSON"

  const binChunkHeader = Buffer.alloc(8);
  binChunkHeader.writeUInt32LE(binChunkData.length, 0);
  binChunkHeader.writeUInt32LE(0x004e4942, 4); // "BIN\0"

  const glb = Buffer.concat([
    header,
    jsonChunkHeader,
    jsonChunkData,
    binChunkHeader,
    binChunkData,
  ]);

  const boundingBox: [number, number, number] = [
    Number((maxX - minX).toFixed(3)),
    Number((maxY - minY).toFixed(3)),
    Number((maxZ - minZ).toFixed(3)),
  ];

  return {
    glb,
    vertexCount,
    triangleCount,
    boundingBox,
  };
}

export function inspectGlbBuffer(buf: Buffer): GlbInspectionResult {
  if (buf.length < 28) {
    throw new Error(`GLB buffer too short (${buf.length} bytes)`);
  }
  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  const totalLength = buf.readUInt32LE(8);
  const jsonChunkLength = buf.readUInt32LE(12);
  const jsonChunkType = buf.readUInt32LE(16);

  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonChunkLength;
  const jsonStr = buf.subarray(jsonStart, jsonEnd).toString('utf8').trimEnd();
  const gltf = JSON.parse(jsonStr) as Record<string, unknown>;

  const binHeaderOffset = jsonEnd;
  const binChunkLength = buf.readUInt32LE(binHeaderOffset);
  const binChunkType = buf.readUInt32LE(binHeaderOffset + 4);

  const accessors = (gltf['accessors'] as Array<Record<string, unknown>> | undefined) ?? [];
  const posAccessor = accessors[0] ?? {};
  const idxAccessor = accessors[2] ?? {};

  const vertexCount = typeof posAccessor['count'] === 'number' ? posAccessor['count'] : 0;
  const idxCount = typeof idxAccessor['count'] === 'number' ? idxAccessor['count'] : 0;
  const triangleCount = Math.floor(idxCount / 3);

  const min = (posAccessor['min'] as number[] | undefined) ?? [0, 0, 0];
  const max = (posAccessor['max'] as number[] | undefined) ?? [0, 0, 0];
  const boundingBox: [number, number, number] = [
    Number(((max[0] ?? 0) - (min[0] ?? 0)).toFixed(3)),
    Number(((max[1] ?? 0) - (min[1] ?? 0)).toFixed(3)),
    Number(((max[2] ?? 0) - (min[2] ?? 0)).toFixed(3)),
  ];

  return {
    magic,
    version,
    totalLength,
    jsonChunkLength,
    jsonChunkType,
    binChunkLength,
    binChunkType,
    vertexCount,
    triangleCount,
    boundingBox,
    gltf,
  };
}
