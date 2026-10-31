/// <reference lib="webworker" />

interface PeakWorkerRequest {
  channels: Float32Array[];
  buckets: number;
}

addEventListener('message', (event: MessageEvent<PeakWorkerRequest>) => {
  const { channels, buckets } = event.data;
  const length = channels[0]?.length ?? 0;
  const safeBuckets = Math.max(1, buckets);
  const out = new Float32Array(safeBuckets * 2);

  if (length === 0 || channels.length === 0) {
    postMessage(out, [out.buffer]);
    return;
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
        const s = ch[i] ?? 0;
        if (s < minVal) minVal = s;
        if (s > maxVal) maxVal = s;
      }
    }
    out[b * 2] = minVal;
    out[b * 2 + 1] = maxVal;
  }

  postMessage(out, [out.buffer]);
});
