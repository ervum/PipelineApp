export interface SseEvent {
  event: string | null;
  data: string;
}

/**
 * Async-iterable Server-Sent Events parser (§4.2).
 * Streams UTF-8 via TextDecoder, splits on `\n\n`, joins multi-line `data:`,
 * skips comment lines (`:...`), and terminates when `data: [DONE]` is encountered.
 */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent, void, unknown> {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  const parseBlock = (block: string): { done: boolean; evt: SseEvent | null } => {
    const lines = block.split('\n');
    let eventName: string | null = null;
    const dataLines: string[] = [];

    for (const rawLine of lines) {
      const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
      if (!line || line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('event:')) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith('data:')) {
        const val = line.slice(5);
        dataLines.push(val.startsWith(' ') ? val.slice(1) : val);
      }
    }

    if (dataLines.length === 0) {
      return { done: false, evt: null };
    }
    const joined = dataLines.join('\n');
    if (joined.trim() === '[DONE]') {
      return { done: true, evt: null };
    }
    return { done: false, evt: { event: eventName, data: joined } };
  };

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');

      let sepIdx = buffer.indexOf('\n\n');
      while (sepIdx !== -1) {
        const rawBlock = buffer.slice(0, sepIdx);
        buffer = buffer.slice(sepIdx + 2);
        const parsed = parseBlock(rawBlock);
        if (parsed.done) {
          return;
        }
        if (parsed.evt) {
          yield parsed.evt;
        }
        sepIdx = buffer.indexOf('\n\n');
      }
    }

    buffer += decoder.decode().replace(/\r\n/g, '\n');
    if (buffer.trim().length > 0) {
      const parsed = parseBlock(buffer);
      if (!parsed.done && parsed.evt) {
        yield parsed.evt;
      }
    }
  } finally {
    reader.releaseLock();
  }
}
