const CHARS_PER_TOKEN = 3.8;
const TRUNCATION_SUFFIX = '\n…[truncated]';

export function estimateTokens(s: string): number {
  if (!s || s.length === 0) return 0;
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

export function truncateToTokens(s: string, max: number): string {
  if (max <= 0) return TRUNCATION_SUFFIX.trimStart();
  const maxChars = Math.floor(max * CHARS_PER_TOKEN);
  if (s.length <= maxChars) return s;

  const slice = s.slice(0, maxChars);

  const lastPara = slice.lastIndexOf('\n\n');
  if (lastPara > maxChars * 0.3) {
    return slice.slice(0, lastPara) + TRUNCATION_SUFFIX;
  }

  const lastLine = slice.lastIndexOf('\n');
  if (lastLine > maxChars * 0.3) {
    return slice.slice(0, lastLine) + TRUNCATION_SUFFIX;
  }

  const lastSpace = slice.lastIndexOf(' ');
  if (lastSpace > maxChars * 0.5) {
    return slice.slice(0, lastSpace) + TRUNCATION_SUFFIX;
  }

  return slice + TRUNCATION_SUFFIX;
}
