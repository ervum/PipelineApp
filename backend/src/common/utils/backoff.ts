/**
 * Exponential backoff with jitter per §4.2:
 * backoff(attempt) = min(30s, 500ms * 2^attempt) + jitter(0..250ms)
 */
export function backoffDelayMs(attempt: number): number {
  const base = Math.min(30_000, 500 * Math.pow(2, Math.max(0, attempt)));
  const jitter = Math.floor(Math.random() * 251);
  return base + jitter;
}

/**
 * Parses an HTTP Retry-After header (seconds or HTTP-date) into milliseconds, capped at 60s.
 */
export function parseRetryAfterMs(headerValue: string | null | undefined): number | null {
  if (!headerValue) return null;
  const trimmed = headerValue.trim();
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(60_000, Math.round(seconds * 1000));
  }
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    const delta = dateMs - Date.now();
    return delta > 0 ? Math.min(60_000, delta) : 0;
  }
  return null;
}
