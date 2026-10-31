export interface DiffSegment {
  op: 'equal' | 'insert' | 'delete';
  text: string;
}

const TOKEN_SPLIT_REGEX = /(\s+|[,.;:!?()])/;
const MAX_LCS_TOKENS = 1500;

function tokenize(input: string): string[] {
  if (!input) return [];
  return input.split(TOKEN_SPLIT_REGEX).filter((t) => t.length > 0);
}

function mergeSegments(segments: DiffSegment[]): DiffSegment[] {
  const merged: DiffSegment[] = [];
  for (const seg of segments) {
    if (!seg.text) continue;
    const prev = merged[merged.length - 1];
    if (prev && prev.op === seg.op) {
      prev.text += seg.text;
    } else {
      merged.push({ op: seg.op, text: seg.text });
    }
  }
  return merged;
}

/**
 * Computes a word/punctuation-level LCS diff between `before` and `after`.
 * Caps each side at 1500 tokens, falling back to whole-block replace for larger inputs.
 */
export function wordDiff(before: string, after: string): DiffSegment[] {
  if (before === after) {
    return before.length > 0 ? [{ op: 'equal', text: before }] : [];
  }
  if (!before) {
    return [{ op: 'insert', text: after }];
  }
  if (!after) {
    return [{ op: 'delete', text: before }];
  }

  const a = tokenize(before);
  const b = tokenize(after);

  if (a.length > MAX_LCS_TOKENS || b.length > MAX_LCS_TOKENS) {
    return [
      { op: 'delete', text: before },
      { op: 'insert', text: after },
    ];
  }

  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i * width + j] = (dp[(i + 1) * width + (j + 1)] ?? 0) + 1;
      } else {
        const down = dp[(i + 1) * width + j] ?? 0;
        const right = dp[i * width + (j + 1)] ?? 0;
        dp[i * width + j] = down >= right ? down : right;
      }
    }
  }

  const raw: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ai = a[i]!;
    const bj = b[j]!;
    if (ai === bj) {
      raw.push({ op: 'equal', text: ai });
      i++;
      j++;
    } else if ((dp[(i + 1) * width + j] ?? 0) >= (dp[i * width + (j + 1)] ?? 0)) {
      raw.push({ op: 'delete', text: ai });
      i++;
    } else {
      raw.push({ op: 'insert', text: bj });
      j++;
    }
  }
  while (i < n) {
    raw.push({ op: 'delete', text: a[i]! });
    i++;
  }
  while (j < m) {
    raw.push({ op: 'insert', text: b[j]! });
    j++;
  }

  return mergeSegments(raw);
}
