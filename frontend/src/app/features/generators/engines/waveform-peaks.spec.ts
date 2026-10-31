import { computePeaks } from './waveform-peaks';

describe('waveform-peaks', () => {
  it('computes interleaved min/max peaks across stereo channels on a synthetic buffer', async () => {
    const ch0 = new Float32Array([0.1, -0.4, 0.2, 0.8, -0.9, 0.3, 0.0, -0.2]);
    const ch1 = new Float32Array([-0.6, 0.5, -0.1, 0.3, 0.2, 0.95, -0.5, 0.4]);

    const syntheticBuffer = {
      length: ch0.length,
      numberOfChannels: 2,
      getChannelData: (c: number) => (c === 0 ? ch0 : ch1),
    };

    const peaks = await computePeaks(syntheticBuffer, 4);
    expect(peaks.length).toBe(8); // 4 buckets * 2 (min, max)

    // Bucket 0: indices 0..1 -> min -0.6, max 0.5
    expect(peaks[0]).toBeCloseTo(-0.6, 4);
    expect(peaks[1]).toBeCloseTo(0.5, 4);

    // Bucket 1: indices 2..3 -> min -0.1, max 0.8
    expect(peaks[2]).toBeCloseTo(-0.1, 4);
    expect(peaks[3]).toBeCloseTo(0.8, 4);

    // Bucket 2: indices 4..5 -> min -0.9, max 0.95
    expect(peaks[4]).toBeCloseTo(-0.9, 4);
    expect(peaks[5]).toBeCloseTo(0.95, 4);

    // Bucket 3: indices 6..7 -> min -0.5, max 0.4
    expect(peaks[6]).toBeCloseTo(-0.5, 4);
    expect(peaks[7]).toBeCloseTo(0.4, 4);
  });
});
