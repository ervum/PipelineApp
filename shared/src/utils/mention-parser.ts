const MENTION_REGEX = /(?:^|\s)@([\w][\w.\-]*(?:\/[\w.\-]+)*)/g;

/**
 * Extracts unique lowercase @mention tokens (without the leading `@`) from text.
 */
export function extractMentions(text: string): string[] {
  const found = new Set<string>();
  const regex = new RegExp(MENTION_REGEX.source, 'g');
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const token = match[1];
    if (token) {
      found.add(token.toLowerCase());
    }
  }
  return [...found];
}

/**
 * Removes the `@` prefix from mentions while preserving the file/alias name in prose.
 */
export function stripMentions(text: string): string {
  return text.replace(/(^|\s)@([\w][\w.\-]*(?:\/[\w.\-]+)*)/g, '$1$2');
}

/**
 * Converts a display file name into a hyphenated mention alias (`Color Palette.md` -> `Color-Palette.md`).
 */
export function toMentionAlias(name: string): string {
  return name.trim().replace(/\s+/g, '-');
}

/**
 * Normalizes a file or path name for case-insensitive mention matching (`Color Palette.md` -> `color-palette.md`).
 */
export function normalizeForMention(name: string): string {
  return toMentionAlias(name).toLowerCase();
}
