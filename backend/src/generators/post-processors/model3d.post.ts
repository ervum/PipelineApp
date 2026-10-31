import { Injectable } from '@nestjs/common';

export interface Model3dMetadata {
  vertexCount: number;
  triangleCount: number;
  boundingBox: [number, number, number];
  hasPbrTextures: boolean;
}

@Injectable()
export class Model3dPostProcessor {
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
}
