export interface WaveformColors {
  barColor: string;
  progressStart: string;
  progressEnd: string;
  centerLine: string;
}

export interface DrawWaveformOptions {
  width: number;
  height: number;
  dpr?: number;
  progress: number;
  barWidth?: number;
  gap?: number;
  colors?: Partial<WaveformColors>;
}

const DEFAULT_COLORS: WaveformColors = {
  barColor: '#3A4060',
  progressStart: '#06B6D4',
  progressEnd: '#7C3AED',
  centerLine: 'rgba(52, 58, 82, 0.6)',
};

export function drawWaveform(
  ctx: CanvasRenderingContext2D,
  peaks: Float32Array,
  opts: DrawWaveformOptions,
): void {
  const dpr = opts.dpr ?? (typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  const w = Math.max(1, Math.floor(opts.width));
  const h = Math.max(1, Math.floor(opts.height));
  const targetW = Math.floor(w * dpr);
  const targetH = Math.floor(h * dpr);

  if (ctx.canvas.width !== targetW || ctx.canvas.height !== targetH) {
    ctx.canvas.width = targetW;
    ctx.canvas.height = targetH;
  }

  ctx.save();
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const colors: WaveformColors = { ...DEFAULT_COLORS, ...opts.colors };
  const barWidth = opts.barWidth ?? 2;
  const gap = opts.gap ?? 1;
  const step = barWidth + gap;
  const barCount = Math.max(1, Math.floor(w / step));
  const bucketCount = Math.floor(peaks.length / 2);
  const midY = h / 2;

  ctx.fillStyle = colors.centerLine;
  ctx.fillRect(0, midY - 0.5, w, 1);

  if (bucketCount === 0) {
    ctx.restore();
    return;
  }

  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, colors.progressStart);
  grad.addColorStop(1, colors.progressEnd);

  const progressX = Math.max(0, Math.min(1, opts.progress)) * w;

  for (let i = 0; i < barCount; i++) {
    const bucketIdx = Math.min(bucketCount - 1, Math.floor((i / barCount) * bucketCount));
    const minVal = Math.abs(peaks[bucketIdx * 2] ?? 0);
    const maxVal = Math.abs(peaks[bucketIdx * 2 + 1] ?? 0);
    const amp = Math.max(0.03, Math.min(1, Math.max(minVal, maxVal)));
    const barH = Math.max(2, amp * (h - 6));
    const x = i * step;
    const y = midY - barH / 2;

    ctx.fillStyle = x <= progressX ? grad : colors.barColor;
    ctx.fillRect(x, y, barWidth, barH);
  }

  ctx.restore();
}
