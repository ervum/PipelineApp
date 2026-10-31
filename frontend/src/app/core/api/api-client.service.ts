import { HttpClient, HttpEvent, HttpParams } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { ErrorCode } from '@forge/shared';
import { Observable, firstValueFrom } from 'rxjs';

export const API_BASE_URL = new InjectionToken<string>('API_BASE_URL', {
  providedIn: 'root',
  factory: () => '/api/v1',
});

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | string;
  readonly details?: unknown;
  readonly traceId?: string;

  constructor(params: {
    status: number;
    code: ErrorCode | string;
    message: string;
    details?: unknown;
    traceId?: string;
  }) {
    super(params.message);
    this.name = 'ApiError';
    this.status = params.status;
    this.code = params.code;
    this.details = params.details;
    this.traceId = params.traceId;
  }
}

export type QueryParamValue = string | number | boolean | null | undefined;

@Injectable({ providedIn: 'root' })
export class ApiClientService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_BASE_URL);

  get<T>(path: string, params?: Record<string, QueryParamValue>): Promise<T> {
    return firstValueFrom(
      this.http.get<T>(this.url(path), {
        params: this.toHttpParams(params),
      }),
    );
  }

  post<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(this.http.post<T>(this.url(path), body ?? {}));
  }

  patch<T>(path: string, body?: unknown): Promise<T> {
    return firstValueFrom(this.http.patch<T>(this.url(path), body ?? {}));
  }

  delete<T = void>(path: string, params?: Record<string, QueryParamValue>): Promise<T> {
    return firstValueFrom(
      this.http.delete<T>(this.url(path), {
        params: this.toHttpParams(params),
      }),
    );
  }

  upload<T>(path: string, formData: FormData): Observable<HttpEvent<T>> {
    return this.http.post<T>(this.url(path), formData, {
      reportProgress: true,
      observe: 'events',
    });
  }

  private url(path: string): string {
    const cleanBase = this.baseUrl.replace(/\/+$/, '');
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${cleanBase}${cleanPath}`;
  }

  private toHttpParams(params?: Record<string, QueryParamValue>): HttpParams {
    let httpParams = new HttpParams();
    if (!params) return httpParams;
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null && value !== '') {
        httpParams = httpParams.set(key, String(value));
      }
    }
    return httpParams;
  }
}
