/**
 * Sanitizes a user- or vendor-supplied filename so it is safe as a single path segment
 * on POSIX, Windows, and S3 keys.
 */
export function sanitizeFilename(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'file';

  const replaced = trimmed
    .replace(/[/\\:*?"<>|\x00-\x1F]+/g, '_')
    .replace(/\.\.+/g, '.')
    .replace(/\s+/g, '-')
    .replace(/^\.+|\.+$/g, '');

  if (!replaced) return 'file';

  if (replaced.length <= 120) {
    return replaced;
  }

  const lastDot = replaced.lastIndexOf('.');
  if (lastDot > 0 && replaced.length - lastDot <= 16) {
    const ext = replaced.slice(lastDot);
    const stem = replaced.slice(0, 120 - ext.length);
    return `${stem}${ext}`;
  }

  return replaced.slice(0, 120);
}
