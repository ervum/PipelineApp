export function computePeaksFromChannels(
  channels: ReadonlyArray<Float32Array>,
  buckets: number,
): Float32Array {
  const safeBuckets = Math.max(1, Math.floor(buckets));
  const out = new Float32Array(safeBuckets * 2);
  const length = channels[0]?.length ?? 0;
  if (length === 0 || channels.length === 0) {
    return out;
  }

  const samplesPerBucket = length / safeBuckets;
  for (let b = 0; b < safeBuckets; b++) {
    const start = Math.floor(b * samplesPerBucket);
    const end = Math.min(length, Math.max(start + 1, Math.floor((b + 1) * samplesPerBucket)));
    let minVal = 0;
    let maxVal = 0;
    for (let c = 0; c < channels.length; c++) {
      const ch = channels[c]!;
      for (let i = start; i < end; i++) {
        const v = ch[i] ?? 0;
        if (v < minVal) minVal = v;
        if (v > maxVal) maxVal = v;
      }
    }
    out[b * 2] = minVal;
    out[b * 2 + 1] = maxVal;
  }

  return out;
}

export async function computePeaks(
  buffer: Pick<AudioBuffer, 'length' | 'numberOfChannels' | 'getChannelData'>,
  buckets: number,
): Promise<Float32Array> {
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    channels.push(buffer.getChannelData(c));
  }

  if (buffer.length > 2_000_000 && typeof Worker !== 'undefined') {
    try {
      return await new Promise<Float32Array>((resolve, reject) => {
        const worker = new Worker(new URL('./waveform-peaks.worker', import.meta.url), {
          type: 'module',
        });
        const cloned = channels.map((c) => new Float32Array(c));
        worker.onmessage = (ev: MessageEvent<Float32Array>) => {
          worker.terminate();
          resolve(ev.data);
        };
        worker.onerror = (err) => {
          worker.terminate();
          reject(err);
        };
        worker.postMessage({ channels: cloned, buckets }, cloned.map((c) => c.buffer));
      });
    } catch {
      return computePeaksFromChannels(channels, buckets);
    }
  }

  return computePeaksFromChannels(channels, buckets);
}
