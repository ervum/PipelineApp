import { Injectable } from '@nestjs/common';
import { HttpClientService } from '../../../common/http/http-client.service';

export interface RunPodPolicy {
  executionTimeout?: number;
  ttl?: number;
}

export interface RunPodRunRequest {
  input: unknown;
  webhook?: string;
  policy?: RunPodPolicy;
}

export interface RunPodRunResponse {
  id: string;
  status: string;
}

export interface RunPodStatusResponse {
  id: string;
  status:
    | 'IN_QUEUE'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'FAILED'
    | 'TIMED_OUT'
    | 'CANCELLED'
    | string;
  delayTime?: number;
  executionTime?: number;
  output?: unknown;
  error?: string;
}

export interface RunPodWorkersHealth {
  idle: number;
  running: number;
  initializing: number;
  ready?: number;
  throttled: number;
  unhealthy?: number;
}

export interface RunPodHealthResponse {
  jobs?: {
    inQueue?: number;
    inProgress?: number;
    completed?: number;
    failed?: number;
  };
  workers?: Partial<RunPodWorkersHealth>;
}

@Injectable()
export class RunPodClient {
  constructor(private readonly http: HttpClientService) {}

  private endpointBaseUrl(endpointId: string, baseUrl?: string | null): string {
    const cleanBase = (baseUrl || 'https://api.runpod.ai/v2').replace(
      /\/$/,
      '',
    );
    if (cleanBase.endsWith(`/${endpointId}`)) {
      return cleanBase;
    }
    return `${cleanBase}/${endpointId}`;
  }

  private headers(
    apiKey: string,
    extraHeaders?: Record<string, string>,
  ): Record<string, string> {
    return {
      ...(extraHeaders ?? {}),
      Authorization: `Bearer ${apiKey}`,
    };
  }

  async run(
    endpointId: string,
    apiKey: string,
    body: RunPodRunRequest,
    opts?: {
      baseUrl?: string | null;
      extraHeaders?: Record<string, string>;
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<RunPodRunResponse> {
    const url = `${this.endpointBaseUrl(endpointId, opts?.baseUrl)}/run`;
    return this.http.request<RunPodRunResponse>(url, {
      method: 'POST',
      headers: this.headers(apiKey, opts?.extraHeaders),
      body: body as unknown as Record<string, unknown>,
      timeoutMs: opts?.timeoutMs ?? 30_000,
      signal: opts?.signal,
    });
  }

  async status(
    endpointId: string,
    apiKey: string,
    jobId: string,
    opts?: {
      baseUrl?: string | null;
      extraHeaders?: Record<string, string>;
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<RunPodStatusResponse> {
    const url = `${this.endpointBaseUrl(endpointId, opts?.baseUrl)}/status/${encodeURIComponent(jobId)}`;
    return this.http.request<RunPodStatusResponse>(url, {
      method: 'GET',
      headers: this.headers(apiKey, opts?.extraHeaders),
      timeoutMs: opts?.timeoutMs ?? 20_000,
      signal: opts?.signal,
    });
  }

  async cancel(
    endpointId: string,
    apiKey: string,
    jobId: string,
    opts?: {
      baseUrl?: string | null;
      extraHeaders?: Record<string, string>;
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<void> {
    const url = `${this.endpointBaseUrl(endpointId, opts?.baseUrl)}/cancel/${encodeURIComponent(jobId)}`;
    await this.http.request(url, {
      method: 'POST',
      headers: this.headers(apiKey, opts?.extraHeaders),
      timeoutMs: opts?.timeoutMs ?? 10_000,
      retries: 0,
      signal: opts?.signal,
    });
  }

  async health(
    endpointId: string,
    apiKey: string,
    opts?: {
      baseUrl?: string | null;
      extraHeaders?: Record<string, string>;
      timeoutMs?: number;
      signal?: AbortSignal;
    },
  ): Promise<RunPodHealthResponse> {
    const url = `${this.endpointBaseUrl(endpointId, opts?.baseUrl)}/health`;
    return this.http.request<RunPodHealthResponse>(url, {
      method: 'GET',
      headers: this.headers(apiKey, opts?.extraHeaders),
      timeoutMs: opts?.timeoutMs ?? 8_000,
      retries: 0,
      signal: opts?.signal,
    });
  }
}
