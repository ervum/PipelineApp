type PathToken =
  | { kind: 'prop'; key: string }
  | { kind: 'wildcard' }
  | { kind: 'index'; index: number };

function parseJsonPath(path: string): PathToken[] {
  const trimmed = path.trim();
  if (!trimmed) return [];

  const tokens: PathToken[] = [];
  const rawSegments = trimmed.split('.');

  for (const segment of rawSegments) {
    if (!segment) continue;
    const bracketRegex = /([^\[\]]+)|\[(\*|-?\d+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = bracketRegex.exec(segment)) !== null) {
      const propName = match[1];
      const bracketInner = match[2];
      if (propName !== undefined) {
        tokens.push({ kind: 'prop', key: propName });
      } else if (bracketInner === '*') {
        tokens.push({ kind: 'wildcard' });
      } else if (bracketInner !== undefined) {
        tokens.push({ kind: 'index', index: Number.parseInt(bracketInner, 10) });
      }
    }
  }

  return tokens;
}

/**
 * Resolves a dot-path with optional `[*]` wildcards and `[n]` array indices against `obj`.
 * Always returns an array of matched values (`unknown[]`), or `[]` when missing.
 */
export function selectPath(obj: unknown, path: string): unknown[] {
  if (obj === undefined || obj === null) return [];
  const tokens = parseJsonPath(path);
  if (tokens.length === 0) return [obj];

  let current: unknown[] = [obj];

  for (const token of tokens) {
    if (current.length === 0) return [];
    const next: unknown[] = [];

    if (token.kind === 'prop') {
      for (const item of current) {
        if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
          const val = (item as Record<string, unknown>)[token.key];
          if (val !== undefined && val !== null) {
            next.push(val);
          }
        }
      }
    } else if (token.kind === 'wildcard') {
      for (const item of current) {
        if (Array.isArray(item)) {
          for (const elem of item) {
            if (elem !== undefined && elem !== null) {
              next.push(elem);
            }
          }
        }
      }
    } else if (token.kind === 'index') {
      for (const item of current) {
        if (Array.isArray(item)) {
          const resolvedIdx = token.index < 0 ? item.length + token.index : token.index;
          const elem = item[resolvedIdx];
          if (elem !== undefined && elem !== null) {
            next.push(elem);
          }
        }
      }
    }

    current = next;
  }

  return current;
}
