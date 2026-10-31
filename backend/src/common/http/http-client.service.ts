import { ErrorCode } from '@forge/shared';
import { Injectable } from '@nestjs/common';
import { DomainError } from '../errors/domain.error';
import { backoffDelayMs, parseRetryAfterMs } from '../utils/backoff';
import { sleep } from '../utils/sleep';

export type HttpResponseType = 'json' | 'buffer' | 'text' | 'stream';

export type FetchBodyInput =
  | string
  | ArrayBuffer
  | ArrayBufferView
  | FormData
  | URLSearchParams
  | Blob;

export interface HttpRequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: FetchBodyInput | Record<string, unknown> | null;
  timeoutMs?: number;
  retries?: number;
  retryOn?: number[];
  responseType?: HttpResponseType;
  signal?: AbortSignal;
}

const DEFAULT_RETRY_STATUSES = [429, 502, 503, 504];

@Injectable()
export class HttpClientService {
  async request<T = unknown>(url: string, opts: HttpRequestOptions = {}): Promise<T> {
    const method = opts.method ?? 'GET';
    const timeoutMs = opts.timeoutMs ?? 60_000;
    const retries = opts.retries ?? 2;
    const retryOn = opts.retryOn ?? DEFAULT_RETRY_STATUSES;
    const responseType = opts.responseType ?? 'json';

    const headers: Record<string, string> = { ...(opts.headers ?? {}) };
    let fetchBody: NonNullable<RequestInit['body']> | undefined;

    if (opts.body !== undefined && opts.body !== null) {
      if (
        typeof opts.body === 'string' ||
        opts.body instanceof ArrayBuffer ||
        ArrayBuffer.isView(opts.body) ||
        opts.body instanceof FormData ||
        opts.body instanceof URLSearchParams ||
        opts.body instanceof Blob
      ) {
        fetchBody = opts.body as NonNullable<RequestInit['body']>;
      } else {
        fetchBody = JSON.stringify(opts.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
      }
    }

    for (let attempt = 0; attempt <= retries; attempt++) {
      const timeoutSignal = AbortSignal.timeout(timeoutMs);
      const combinedSignal = opts.signal
        ? AbortSignal.any([opts.signal, timeoutSignal])
        : timeoutSignal;

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers,
          body: fetchBody,
          signal: combinedSignal,
        });
      } catch (err) {
        if (opts.signal?.aborted) {
          throw new DomainError(ErrorCode.PROVIDER_ERROR, 499, 'Request cancelled');
        }
        const isTimeout =
          timeoutSignal.aborted ||
          (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError'));
        if (attempt < retries) {
          await sleep(backoffDelayMs(attempt), opts.signal);
          continue;
        }
        if (isTimeout) {
          throw new DomainError(
            ErrorCode.PROVIDER_TIMEOUT,
            504,
            `Provider request timed out after ${timeoutMs}ms: ${method} ${url}`,
          );
        }
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          `Network error calling provider (${method} ${url}): ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      if (!response.ok) {
        const status = response.status;
        if (attempt < retries && retryOn.includes(status)) {
          const retryAfter = parseRetryAfterMs(response.headers.get('retry-after'));
          const delay = retryAfter ?? backoffDelayMs(attempt);
          await sleep(delay, opts.signal);
          continue;
        }

        let bodyExcerpt = '';
        try {
          const text = await response.text();
          bodyExcerpt = text.slice(0, 2048);
        } catch {
          bodyExcerpt = '';
        }

        if (status === 401 || status === 403) {
          throw new DomainError(
            ErrorCode.PROVIDER_AUTH_FAILED,
            502,
            `Provider authentication failed (${status}) for ${method} ${url}`,
            { status, body: bodyExcerpt },
          );
        }
        if (status === 429) {
          throw new DomainError(
            ErrorCode.PROVIDER_RATE_LIMITED,
            429,
            `Provider rate limit exceeded (429) for ${method} ${url}`,
            { status, body: bodyExcerpt },
          );
        }
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          `Provider returned HTTP ${status} for ${method} ${url}`,
          { status, body: bodyExcerpt },
        );
      }

      if (responseType === 'stream') {
        if (!response.body) {
          throw new DomainError(
            ErrorCode.PROVIDER_ERROR,
            502,
            `Provider returned empty stream body for ${method} ${url}`,
          );
        }
        return response.body as unknown as T;
      }
      if (responseType === 'buffer') {
        const ab = await response.arrayBuffer();
        return Buffer.from(ab) as unknown as T;
      }
      if (responseType === 'text') {
        return (await response.text()) as unknown as T;
      }
      const text = await response.text();
      if (!text) {
        return {} as T;
      }
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new DomainError(
          ErrorCode.PROVIDER_ERROR,
          502,
          `Provider returned invalid JSON for ${method} ${url}`,
          { body: text.slice(0, 2048) },
        );
      }
    }

    throw new DomainError(ErrorCode.PROVIDER_ERROR, 502, `Exhausted retries for ${method} ${url}`);
  }
}
