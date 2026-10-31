import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { ApiError } from '../api/api-client.service';
import { ToastService } from '../state/toast.service';

interface ErrorEnvelopeShape {
  statusCode?: number;
  code?: string;
  message?: string;
  details?: unknown;
  traceId?: string;
}

export const apiErrorInterceptor: HttpInterceptorFn = (req, next) => {
  const toast = inject(ToastService);

  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        const body = (err.error ?? {}) as ErrorEnvelopeShape;
        const status = err.status || body.statusCode || 500;
        const code = typeof body.code === 'string' ? body.code : 'INTERNAL_ERROR';
        const message =
          typeof body.message === 'string' && body.message.length > 0
            ? body.message
            : err.message || 'Network request failed';

        const apiError = new ApiError({
          status,
          code,
          message,
          details: body.details,
          traceId: body.traceId,
        });

        if (status === 0 || status >= 500) {
          toast.error(message, { title: code });
        }

        return throwError(() => apiError);
      }

      const fallback = new ApiError({
        status: 500,
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Unexpected error',
      });
      toast.error(fallback.message);
      return throwError(() => fallback);
    }),
  );
};
