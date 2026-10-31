import { inspectGlbBuffer, synthesizeGlbMesh } from '../src/synth/glb-mesh.synth';

describe('glb-mesh.synth', () => {
  it('writes a valid glTF 2.0 binary (.glb) with 4-byte aligned JSON and BIN chunks', () => {
    const res = synthesizeGlbMesh({
      prompt: 'Starforged katana with #F5C451 gold filigree and #3CD3F0 cyan rim',
      seed: 20261022,
      category: 'WEAPON',
    });

    expect(res.glb.length).toBeGreaterThan(100);
    expect(res.glb.length % 4).toBe(0);

    const info = inspectGlbBuffer(res.glb);
    expect(info.magic).toBe(0x46546c67); // "glTF"
    expect(info.version).toBe(2);
    expect(info.totalLength).toBe(res.glb.length);
    expect(info.jsonChunkType).toBe(0x4e4f534a); // "JSON"
    expect(info.jsonChunkLength % 4).toBe(0);
    expect(info.binChunkType).toBe(0x004e4942); // "BIN\0"
    expect(info.binChunkLength % 4).toBe(0);
  });

  it('produces valid POSITION, NORMAL, and index accessors with accurate bounds for all categories', () => {
    const categories = ['WEAPON', 'PROP', 'ENVIRONMENT', 'CHARACTER_BASE'] as const;
    for (const category of categories) {
      const res = synthesizeGlbMesh({
        prompt: `Test ${category} mesh with #7C3AED base`,
        seed: 42,
        category,
        pose: 'A_POSE',
      });

      const info = inspectGlbBuffer(res.glb);
      expect(info.vertexCount).toBe(res.vertexCount);
      expect(info.triangleCount).toBe(res.triangleCount);
      expect(info.vertexCount).toBeGreaterThan(20);
      expect(info.triangleCount).toBeGreaterThan(10);
      expect(info.boundingBox[0]).toBeGreaterThan(0);
      expect(info.boundingBox[1]).toBeGreaterThan(0);
      expect(info.boundingBox[2]).toBeGreaterThan(0);

      const materials = info.gltf['materials'] as Array<Record<string, unknown>>;
      expect(materials).toHaveLength(1);
      const pbr = materials[0]?.['pbrMetallicRoughness'] as Record<string, unknown>;
      expect(Array.isArray(pbr['baseColorFactor'])).toBe(true);
    }
  });

  it('is byte-for-byte deterministic for the same seed and parameters', () => {
    const a = synthesizeGlbMesh({ prompt: 'Anvil #1B1446', seed: 999, category: 'PROP' });
    const b = synthesizeGlbMesh({ prompt: 'Anvil #1B1446', seed: 999, category: 'PROP' });
    expect(a.glb.equals(b.glb)).toBe(true);
  });
});
