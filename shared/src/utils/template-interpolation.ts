const WHOLE = /^\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}$/;
const INLINE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export interface InterpolationResult {
  value: unknown;
  missing: string[];
  used: string[];
}

export function resolveVar(vars: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>(
    (acc, k) =>
      acc !== null && typeof acc === 'object'
        ? (acc as Record<string, unknown>)[k]
        : undefined,
    vars,
  );
}

export function interpolateTemplate(
  template: unknown,
  vars: Record<string, unknown>,
): InterpolationResult {
  const missing = new Set<string>();
  const used = new Set<string>();

  const walk = (node: unknown): unknown => {
    if (typeof node === 'string') {
      const whole = WHOLE.exec(node);
      if (whole) {
        const key = whole[1]!;
        const v = resolveVar(vars, key);
        used.add(key);
        if (v === undefined) {
          missing.add(key);
          return null;
        }
        return v;
      }
      return node.replace(INLINE, (_m, key: string) => {
        used.add(key);
        const v = resolveVar(vars, key);
        if (v === undefined || v === null) {
          missing.add(key);
          return '';
        }
        return typeof v === 'string' ? v : JSON.stringify(v);
      });
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node !== null && typeof node === 'object') {
      return Object.fromEntries(
        Object.entries(node as Record<string, unknown>).map(([k, v]) => [k, walk(v)]),
      );
    }
    return node;
  };

  return { value: walk(template), missing: [...missing], used: [...used] };
}
