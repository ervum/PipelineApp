import { Injectable } from '@nestjs/common';
import sharp from 'sharp';

export interface Model3dMetadata {
  vertexCount: number;
  triangleCount: number;
  boundingBox: [number, number, number];
  hasPbrTextures: boolean;
}

interface ExtractedGlbGeometry {
  positions: Float32Array;
  indices: Uint32Array;
  baseColorHex: string;
}

@Injectable()
export class Model3dPostProcessor {
  inspectObj(
    buf: Buffer,
    fallbackMeta?: Partial<Model3dMetadata>,
  ): Model3dMetadata {
    const text = buf.toString('utf8');
    const lines = text.split(/\r?\n/);

    let vertexCount = 0;
    let triangleCount = 0;
    let hasMaterials = false;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (line.startsWith('v ')) {
        const parts = line.split(/\s+/);
        if (parts.length >= 4) {
          vertexCount++;
          const x = Number(parts[1]);
          const y = Number(parts[2]);
          const z = Number(parts[3]);
          if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z)) {
            if (x < minX) minX = x;
            if (y < minY) minY = y;
            if (z < minZ) minZ = z;
            if (x > maxX) maxX = x;
            if (y > maxY) maxY = y;
            if (z > maxZ) maxZ = z;
          }
        }
      } else if (line.startsWith('f ')) {
        const faceTokens = line.slice(2).trim().split(/\s+/).filter(Boolean);
        if (faceTokens.length >= 3) {
          triangleCount += faceTokens.length - 2;
        }
      } else if (line.startsWith('mtllib ') || line.startsWith('usemtl ')) {
        hasMaterials = true;
      }
    }

    const boundingBox: [number, number, number] =
      Number.isFinite(minX) && Number.isFinite(maxX)
        ? [
            Number((maxX - minX).toFixed(3)),
            Number((maxY - minY).toFixed(3)),
            Number((maxZ - minZ).toFixed(3)),
          ]
        : (fallbackMeta?.boundingBox ?? [1, 1, 1]);

    return {
      vertexCount: vertexCount || fallbackMeta?.vertexCount || 0,
      triangleCount: triangleCount || fallbackMeta?.triangleCount || 0,
      boundingBox,
      hasPbrTextures: fallbackMeta?.hasPbrTextures ?? hasMaterials,
    };
  }

  inspectGlb(
    buf: Buffer,
    fallbackMeta?: Partial<Model3dMetadata>,
  ): Model3dMetadata {
    try {
      if (buf.length >= 28 && buf.readUInt32LE(0) === 0x46546c67) {
        const jsonChunkLength = buf.readUInt32LE(12);
        const jsonChunkType = buf.readUInt32LE(16);
        if (
          jsonChunkType === 0x4e4f534a &&
          20 + jsonChunkLength <= buf.length
        ) {
          const jsonStr = buf
            .subarray(20, 20 + jsonChunkLength)
            .toString('utf8')
            .trimEnd();
          const gltf = JSON.parse(jsonStr) as Record<string, unknown>;
          const accessors = Array.isArray(gltf['accessors'])
            ? (gltf['accessors'] as Array<Record<string, unknown>>)
            : [];
          const meshes = Array.isArray(gltf['meshes'])
            ? (gltf['meshes'] as Array<Record<string, unknown>>)
            : [];

          let vertexCount = 0;
          let indexCount = 0;
          let minX = Infinity;
          let minY = Infinity;
          let minZ = Infinity;
          let maxX = -Infinity;
          let maxY = -Infinity;
          let maxZ = -Infinity;

          for (const mesh of meshes) {
            const primitives = Array.isArray(mesh['primitives'])
              ? (mesh['primitives'] as Array<Record<string, unknown>>)
              : [];
            for (const prim of primitives) {
              const attrs =
                typeof prim['attributes'] === 'object' &&
                prim['attributes'] !== null
                  ? (prim['attributes'] as Record<string, unknown>)
                  : {};
              const posIdx = attrs['POSITION'];
              if (typeof posIdx === 'number' && accessors[posIdx]) {
                const posAcc = accessors[posIdx]!;
                if (typeof posAcc['count'] === 'number') {
                  vertexCount += posAcc['count'];
                }
                const minArr = posAcc['min'] as number[] | undefined;
                const maxArr = posAcc['max'] as number[] | undefined;
                if (Array.isArray(minArr) && minArr.length >= 3) {
                  if (minArr[0]! < minX) minX = minArr[0]!;
                  if (minArr[1]! < minY) minY = minArr[1]!;
                  if (minArr[2]! < minZ) minZ = minArr[2]!;
                }
                if (Array.isArray(maxArr) && maxArr.length >= 3) {
                  if (maxArr[0]! > maxX) maxX = maxArr[0]!;
                  if (maxArr[1]! > maxY) maxY = maxArr[1]!;
                  if (maxArr[2]! > maxZ) maxZ = maxArr[2]!;
                }
              }

              const indIdx = prim['indices'];
              if (typeof indIdx === 'number' && accessors[indIdx]) {
                const indAcc = accessors[indIdx]!;
                if (typeof indAcc['count'] === 'number') {
                  indexCount += indAcc['count'];
                }
              }
            }
          }

          const triangleCount =
            indexCount > 0
              ? Math.floor(indexCount / 3)
              : Math.floor(vertexCount / 3);

          const boundingBox: [number, number, number] =
            Number.isFinite(minX) && Number.isFinite(maxX)
              ? [
                  Number((maxX - minX).toFixed(3)),
                  Number((maxY - minY).toFixed(3)),
                  Number((maxZ - minZ).toFixed(3)),
                ]
              : (fallbackMeta?.boundingBox ?? [1, 1, 1]);

          const materials = Array.isArray(gltf['materials'])
            ? gltf['materials']
            : [];

          return {
            vertexCount: vertexCount || fallbackMeta?.vertexCount || 0,
            triangleCount: triangleCount || fallbackMeta?.triangleCount || 0,
            boundingBox,
            hasPbrTextures:
              fallbackMeta?.hasPbrTextures ?? materials.length > 0,
          };
        }
      } else {
        const headStr = buf.subarray(0, Math.min(512, buf.length)).toString('utf8');
        if (/^(#|\s*v\s+|\s*o\s+|\s*mtllib\s+)/m.test(headStr)) {
          return this.inspectObj(buf, fallbackMeta);
        }
      }
    } catch {
      // Fall through to fallback
    }

    return {
      vertexCount: fallbackMeta?.vertexCount ?? 0,
      triangleCount: fallbackMeta?.triangleCount ?? 0,
      boundingBox: fallbackMeta?.boundingBox ?? [1, 1, 1],
      hasPbrTextures: fallbackMeta?.hasPbrTextures ?? false,
    };
  }

  private extractGlbGeometry(buf: Buffer): ExtractedGlbGeometry | null {
    try {
      if (buf.length < 28 || buf.readUInt32LE(0) !== 0x46546c67) return null;
      const jsonLen = buf.readUInt32LE(12);
      const jsonType = buf.readUInt32LE(16);
      if (jsonType !== 0x4e4f534a || 20 + jsonLen > buf.length) return null;

      const gltf = JSON.parse(
        buf.subarray(20, 20 + jsonLen).toString('utf8').trimEnd(),
      ) as Record<string, unknown>;

      const binChunkHeaderOffset = 20 + jsonLen;
      if (binChunkHeaderOffset + 8 > buf.length) return null;
      const binLen = buf.readUInt32LE(binChunkHeaderOffset);
      const binType = buf.readUInt32LE(binChunkHeaderOffset + 4);
      if (
        binType !== 0x004e4942 ||
        binChunkHeaderOffset + 8 + binLen > buf.length
      ) {
        return null;
      }
      const binBuf = buf.subarray(
        binChunkHeaderOffset + 8,
        binChunkHeaderOffset + 8 + binLen,
      );

      const accessors = (gltf['accessors'] as Array<Record<string, unknown>>) ?? [];
      const bufferViews =
        (gltf['bufferViews'] as Array<Record<string, unknown>>) ?? [];
      const meshes = (gltf['meshes'] as Array<Record<string, unknown>>) ?? [];
      const materials =
        (gltf['materials'] as Array<Record<string, unknown>>) ?? [];

      const prim = (
        meshes[0]?.['primitives'] as Array<Record<string, unknown>> | undefined
      )?.[0];
      if (!prim) return null;

      const attrs = (prim['attributes'] as Record<string, number>) ?? {};
      const posAccIdx = attrs['POSITION'];
      if (typeof posAccIdx !== 'number' || !accessors[posAccIdx]) return null;

      const posAcc = accessors[posAccIdx]!;
      const posBv = bufferViews[posAcc['bufferView'] as number];
      if (!posBv) return null;

      const posOffset =
        ((posBv['byteOffset'] as number) ?? 0) +
        ((posAcc['byteOffset'] as number) ?? 0);
      const vCount = (posAcc['count'] as number) ?? 0;
      if (vCount <= 0 || posOffset + vCount * 12 > binBuf.length) return null;

      const positions = new Float32Array(vCount * 3);
      for (let i = 0; i < vCount * 3; i++) {
        positions[i] = binBuf.readFloatLE(posOffset + i * 4);
      }

      let indices: Uint32Array;
      const indAccIdx = prim['indices'] as number | undefined;
      if (typeof indAccIdx === 'number' && accessors[indAccIdx]) {
        const indAcc = accessors[indAccIdx]!;
        const indBv = bufferViews[indAcc['bufferView'] as number];
        const iCount = (indAcc['count'] as number) ?? 0;
        const compType = (indAcc['componentType'] as number) ?? 5123;
        const indOffset =
          ((indBv?.['byteOffset'] as number) ?? 0) +
          ((indAcc['byteOffset'] as number) ?? 0);

        indices = new Uint32Array(iCount);
        for (let i = 0; i < iCount; i++) {
          if (compType === 5125) {
            indices[i] = binBuf.readUInt32LE(indOffset + i * 4);
          } else if (compType === 5123) {
            indices[i] = binBuf.readUInt16LE(indOffset + i * 2);
          } else {
            indices[i] = binBuf.readUInt8(indOffset + i);
          }
        }
      } else {
        indices = new Uint32Array(vCount);
        for (let i = 0; i < vCount; i++) indices[i] = i;
      }

      let baseColorHex = '#8B5CF6';
      const pbr = materials[0]?.['pbrMetallicRoughness'] as
        | Record<string, unknown>
        | undefined;
      const factor = pbr?.['baseColorFactor'] as number[] | undefined;
      if (Array.isArray(factor) && factor.length >= 3) {
        const toHex = (n: number): string =>
          Math.max(0, Math.min(255, Math.round(n * 255)))
            .toString(16)
            .padStart(2, '0');
        baseColorHex = `#${toHex(factor[0]!)}${toHex(factor[1]!)}${toHex(factor[2]!)}`;
      }

      return { positions, indices, baseColorHex };
    } catch {
      return null;
    }
  }

  /**
   * Renders an orthographic shaded + wireframe WebP thumbnail from a binary .glb buffer
   * when an upstream 3D provider does not supply a preview image.
   */
  async renderGlbThumbnail(buf: Buffer, size = 384): Promise<Buffer | null> {
    const geom = this.extractGlbGeometry(buf);
    if (!geom || geom.positions.length < 9 || geom.indices.length < 3) {
      return null;
    }

    const { positions, indices, baseColorHex } = geom;
    const vCount = positions.length / 3;

    // Isometric yaw (35 deg) + pitch (25 deg) rotation
    const cosY = Math.cos(0.61);
    const sinY = Math.sin(0.61);
    const cosX = Math.cos(0.43);
    const sinX = Math.sin(0.43);

    const rotX = new Float32Array(vCount);
    const rotY = new Float32Array(vCount);
    const rotZ = new Float32Array(vCount);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < vCount; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;

      const rx = x * cosY + z * sinY;
      const rz0 = -x * sinY + z * cosY;
      const ry = y * cosX - rz0 * sinX;
      const rz = y * sinX + rz0 * cosX;

      rotX[i] = rx;
      rotY[i] = ry;
      rotZ[i] = rz;

      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;
    }

    const span = Math.max(1e-4, maxX - minX, maxY - minY);
    const scale = (size * 0.72) / span;
    const midX = (minX + maxX) / 2;
    const midY = (minY + maxY) / 2;

    const baseR = parseInt(baseColorHex.slice(1, 3), 16) || 139;
    const baseG = parseInt(baseColorHex.slice(3, 5), 16) || 92;
    const baseB = parseInt(baseColorHex.slice(5, 7), 16) || 246;

    const triCount = Math.floor(indices.length / 3);
    const step = Math.max(1, Math.ceil(triCount / 2500));

    interface ProjectedTri {
      depth: number;
      pts: string;
      fill: string;
    }
    const tris: ProjectedTri[] = [];

    for (let t = 0; t < triCount; t += step) {
      const i0 = indices[t * 3]!;
      const i1 = indices[t * 3 + 1]!;
      const i2 = indices[t * 3 + 2]!;
      if (i0 >= vCount || i1 >= vCount || i2 >= vCount) continue;

      const x0 = size / 2 + (rotX[i0]! - midX) * scale;
      const y0 = size / 2 - (rotY[i0]! - midY) * scale;
      const x1 = size / 2 + (rotX[i1]! - midX) * scale;
      const y1 = size / 2 - (rotY[i1]! - midY) * scale;
      const x2 = size / 2 + (rotX[i2]! - midX) * scale;
      const y2 = size / 2 - (rotY[i2]! - midY) * scale;

      const ux = rotX[i1]! - rotX[i0]!;
      const uy = rotY[i1]! - rotY[i0]!;
      const uz = rotZ[i1]! - rotZ[i0]!;
      const vx = rotX[i2]! - rotX[i0]!;
      const vy = rotY[i2]! - rotY[i0]!;
      const vz = rotZ[i2]! - rotZ[i0]!;
      const nx = uy * vz - uz * vy;
      const ny = uz * vx - ux * vz;
      const nz = ux * vy - uy * vx;
      const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;

      const lightDot = Math.abs(
        (nx * 0.45 + ny * 0.65 + nz * 0.61) / nLen,
      );
      const shade = 0.35 + 0.65 * lightDot;
      const r = Math.min(255, Math.round(baseR * shade));
      const g = Math.min(255, Math.round(baseG * shade));
      const b = Math.min(255, Math.round(baseB * shade));

      tris.push({
        depth: (rotZ[i0]! + rotZ[i1]! + rotZ[i2]!) / 3,
        pts: `${x0.toFixed(1)},${y0.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)}`,
        fill: `rgb(${r},${g},${b})`,
      });
    }

    tris.sort((a, b) => a.depth - b.depth);
    const polyEls = tris
      .map(
        (tr) =>
          `<polygon points="${tr.pts}" fill="${tr.fill}" stroke="rgba(255,255,255,0.18)" stroke-width="0.6" stroke-linejoin="round" />`,
      )
      .join('');

    const svg = [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`,
      `<defs><radialGradient id="bg" cx="50%" cy="45%" r="60%"><stop offset="0%" stop-color="#1E1638"/><stop offset="100%" stop-color="#0B0914"/></radialGradient></defs>`,
      `<rect width="${size}" height="${size}" fill="url(#bg)"/>`,
      polyEls,
      `</svg>`,
    ].join('');

    return sharp(Buffer.from(svg, 'utf8')).webp({ quality: 84 }).toBuffer();
  }

  /**
   * Generates LOD1 (~50% triangle retention) and LOD2 (~25% triangle retention)
   * binary .glb buffers using vertex grid clustering with triangle stride fallback.
   */
  generateGlbLods(buf: Buffer): { lod1?: Buffer; lod2?: Buffer } {
    const geom = this.extractGlbGeometry(buf);
    if (!geom || geom.positions.length < 9 || geom.indices.length < 6) {
      return {};
    }

    const lod1Geom = this.decimateGeometry(geom, 0.5, 16);
    const lod2Geom = this.decimateGeometry(geom, 0.25, 8);

    const lod1 = this.packGlbGeometry(lod1Geom);
    const lod2 = this.packGlbGeometry(lod2Geom);
    return {
      ...(lod1 ? { lod1 } : {}),
      ...(lod2 ? { lod2 } : {}),
    };
  }

  private decimateGeometry(
    geom: ExtractedGlbGeometry,
    targetRatio: number,
    gridResolution: number,
  ): ExtractedGlbGeometry {
    const { positions, indices, baseColorHex } = geom;
    const vCount = positions.length / 3;
    const triCount = Math.floor(indices.length / 3);

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    for (let i = 0; i < vCount; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
    }

    const spanX = Math.max(1e-5, maxX - minX);
    const spanY = Math.max(1e-5, maxY - minY);
    const spanZ = Math.max(1e-5, maxZ - minZ);

    const cellToNewVertex = new Map<string, number>();
    const vertexRemap = new Uint32Array(vCount);
    const accumX: number[] = [];
    const accumY: number[] = [];
    const accumZ: number[] = [];
    const accumCount: number[] = [];

    for (let i = 0; i < vCount; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      const gx = Math.min(
        gridResolution - 1,
        Math.floor(((x - minX) / spanX) * gridResolution),
      );
      const gy = Math.min(
        gridResolution - 1,
        Math.floor(((y - minY) / spanY) * gridResolution),
      );
      const gz = Math.min(
        gridResolution - 1,
        Math.floor(((z - minZ) / spanZ) * gridResolution),
      );
      const key = `${gx}_${gy}_${gz}`;
      let newIdx = cellToNewVertex.get(key);
      if (newIdx === undefined) {
        newIdx = accumX.length;
        cellToNewVertex.set(key, newIdx);
        accumX.push(x);
        accumY.push(y);
        accumZ.push(z);
        accumCount.push(1);
      } else {
        accumX[newIdx]! += x;
        accumY[newIdx]! += y;
        accumZ[newIdx]! += z;
        accumCount[newIdx]! += 1;
      }
      vertexRemap[i] = newIdx;
    }

    const clusteredIndices: number[] = [];
    for (let t = 0; t < triCount; t++) {
      const i0 = vertexRemap[indices[t * 3]!]!;
      const i1 = vertexRemap[indices[t * 3 + 1]!]!;
      const i2 = vertexRemap[indices[t * 3 + 2]!]!;
      if (i0 !== i1 && i1 !== i2 && i2 !== i0) {
        clusteredIndices.push(i0, i1, i2);
      }
    }

    const targetTris = Math.max(1, Math.floor(triCount * targetRatio));
    const clusteredTriCount = Math.floor(clusteredIndices.length / 3);

    if (clusteredTriCount >= 1 && clusteredTriCount < triCount) {
      const newVCount = accumX.length;
      const newPositions = new Float32Array(newVCount * 3);
      for (let i = 0; i < newVCount; i++) {
        const cnt = accumCount[i]!;
        newPositions[i * 3] = accumX[i]! / cnt;
        newPositions[i * 3 + 1] = accumY[i]! / cnt;
        newPositions[i * 3 + 2] = accumZ[i]! / cnt;
      }
      const maxKeepIndices = Math.min(
        clusteredIndices.length,
        targetTris * 3,
      );
      return {
        positions: newPositions,
        indices: new Uint32Array(clusteredIndices.slice(0, maxKeepIndices)),
        baseColorHex,
      };
    }

    // Fallback for low-poly meshes where grid clustering leaves all triangles intact or collapses all:
    const keepIndices = new Uint32Array(targetTris * 3);
    for (let t = 0; t < targetTris; t++) {
      const srcT = Math.min(
        triCount - 1,
        Math.floor((t / targetTris) * triCount),
      );
      keepIndices[t * 3] = indices[srcT * 3]!;
      keepIndices[t * 3 + 1] = indices[srcT * 3 + 1]!;
      keepIndices[t * 3 + 2] = indices[srcT * 3 + 2]!;
    }
    return {
      positions,
      indices: keepIndices,
      baseColorHex,
    };
  }

  private packGlbGeometry(geom: ExtractedGlbGeometry): Buffer | null {
    const { positions, indices, baseColorHex } = geom;
    const vCount = positions.length / 3;
    const iCount = indices.length;
    if (vCount < 3 || iCount < 3) return null;

    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;

    const posByteLen = vCount * 12;
    const indByteLen = iCount * 2;
    const posBuf = Buffer.alloc(posByteLen);
    for (let i = 0; i < vCount; i++) {
      const x = positions[i * 3]!;
      const y = positions[i * 3 + 1]!;
      const z = positions[i * 3 + 2]!;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (z < minZ) minZ = z;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
      if (z > maxZ) maxZ = z;
      posBuf.writeFloatLE(x, i * 12);
      posBuf.writeFloatLE(y, i * 12 + 4);
      posBuf.writeFloatLE(z, i * 12 + 8);
    }

    const indBuf = Buffer.alloc(indByteLen);
    for (let i = 0; i < iCount; i++) {
      indBuf.writeUInt16LE(Math.min(65535, indices[i]!), i * 2);
    }

    const rawBin = Buffer.concat([posBuf, indBuf]);
    const binPad = (4 - (rawBin.length % 4)) % 4;
    const binChunk =
      binPad > 0 ? Buffer.concat([rawBin, Buffer.alloc(binPad, 0)]) : rawBin;

    const r = (parseInt(baseColorHex.slice(1, 3), 16) || 139) / 255;
    const g = (parseInt(baseColorHex.slice(3, 5), 16) || 92) / 255;
    const b = (parseInt(baseColorHex.slice(5, 7), 16) || 246) / 255;

    const gltf = {
      asset: { version: '2.0', generator: 'ForgeStudio LOD Decimator' },
      scene: 0,
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0 }],
      materials: [
        {
          pbrMetallicRoughness: {
            baseColorFactor: [
              Number(r.toFixed(3)),
              Number(g.toFixed(3)),
              Number(b.toFixed(3)),
              1,
            ],
          },
        },
      ],
      meshes: [
        {
          primitives: [{ attributes: { POSITION: 0 }, indices: 1, material: 0 }],
        },
      ],
      buffers: [{ byteLength: rawBin.length }],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: posByteLen, target: 34962 },
        {
          buffer: 0,
          byteOffset: posByteLen,
          byteLength: indByteLen,
          target: 34963,
        },
      ],
      accessors: [
        {
          bufferView: 0,
          componentType: 5126,
          count: vCount,
          type: 'VEC3',
          min: [minX, minY, minZ],
          max: [maxX, maxY, maxZ],
        },
        {
          bufferView: 1,
          componentType: 5123,
          count: iCount,
          type: 'SCALAR',
        },
      ],
    };

    const jsonBytes = Buffer.from(JSON.stringify(gltf), 'utf8');
    const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
    const jsonChunk =
      jsonPad > 0
        ? Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)])
        : jsonBytes;

    const totalLen = 12 + 8 + jsonChunk.length + 8 + binChunk.length;
    const header = Buffer.alloc(12);
    header.writeUInt32LE(0x46546c67, 0);
    header.writeUInt32LE(2, 4);
    header.writeUInt32LE(totalLen, 8);

    const jsonHeader = Buffer.alloc(8);
    jsonHeader.writeUInt32LE(jsonChunk.length, 0);
    jsonHeader.writeUInt32LE(0x4e4f534a, 4);

    const binHeader = Buffer.alloc(8);
    binHeader.writeUInt32LE(binChunk.length, 0);
    binHeader.writeUInt32LE(0x004e4942, 4);

    return Buffer.concat([header, jsonHeader, jsonChunk, binHeader, binChunk]);
  }
}
