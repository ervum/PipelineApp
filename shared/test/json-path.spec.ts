import { selectPath } from '../src';

describe('json-path (selectPath)', () => {
  it('resolves simple dot-separated scalar paths as a single-element array', () => {
    const obj = { output: { audio_url: 'https://cdn.example.com/a.wav' } };
    expect(selectPath(obj, 'output.audio_url')).toEqual(['https://cdn.example.com/a.wav']);
  });

  it('flattens arrays with wildcard [*] and extracts nested properties', () => {
    const obj = {
      output: {
        images: [
          { data: 'b64_1', seed: 1 },
          { data: 'b64_2', seed: 2 },
        ],
      },
    };
    expect(selectPath(obj, 'output.images[*].data')).toEqual(['b64_1', 'b64_2']);
  });

  it('supports wildcard [*] on primitive arrays', () => {
    const obj = { output: { urls: ['https://a.png', 'https://b.png'] } };
    expect(selectPath(obj, 'output.urls[*]')).toEqual(['https://a.png', 'https://b.png']);
  });

  it('supports numeric array index [0] and negative indices [-1]', () => {
    const obj = {
      output: {
        items: [{ url: 'first.glb' }, { url: 'second.glb' }, { url: 'last.glb' }],
      },
    };
    expect(selectPath(obj, 'output.items[0].url')).toEqual(['first.glb']);
    expect(selectPath(obj, 'output.items[1].url')).toEqual(['second.glb']);
    expect(selectPath(obj, 'output.items[-1].url')).toEqual(['last.glb']);
  });

  it('supports multi-level nested wildcards', () => {
    const obj = {
      batches: [
        { frames: ['f1', 'f2'] },
        { frames: ['f3', 'f4'] },
      ],
    };
    expect(selectPath(obj, 'batches[*].frames[*]')).toEqual(['f1', 'f2', 'f3', 'f4']);
  });

  it('returns an empty array when path is missing or input is null/undefined', () => {
    const obj = { output: { images: [] } };
    expect(selectPath(obj, 'output.images[*].data')).toEqual([]);
    expect(selectPath(obj, 'output.nonexistent.deep')).toEqual([]);
    expect(selectPath(null, 'output.images')).toEqual([]);
    expect(selectPath(undefined, 'output.images')).toEqual([]);
  });
});
