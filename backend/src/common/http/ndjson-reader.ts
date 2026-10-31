/**
 * Async-iterable NDJSON parser (§4.2).
 * Yields `JSON.parse(line)` for each non-empty line in the stream.
 */
export async function* readNdjson<T = unknown>(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<T, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      let nlIdx = buffer.indexOf('\n');
      while (nlIdx !== -1) {
        const line = buffer.slice(0, nlIdx).trim();
        buffer = buffer.slice(nlIdx + 1);
        if (line.length > 0) {
          yield JSON.parse(line) as T;
        }
        nlIdx = buffer.indexOf('\n');
      }
    }

    buffer += decoder.decode();
    const trailing = buffer.trim();
    if (trailing.length > 0) {
      yield JSON.parse(trailing) as T;
    }
  } finally {
    reader.releaseLock();
  }
}
