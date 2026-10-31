import { Injectable, signal } from '@angular/core';

export type ToastKind = 'success' | 'info' | 'warn' | 'error';

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  title?: string;
  durationMs: number;
  createdAt: number;
}

export interface ToastOptions {
  title?: string;
  durationMs?: number;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  success(message: string, opts?: ToastOptions): string {
    return this.push('success', message, opts);
  }

  info(message: string, opts?: ToastOptions): string {
    return this.push('info', message, opts);
  }

  warn(message: string, opts?: ToastOptions): string {
    return this.push('warn', message, opts);
  }

  error(message: string, opts?: ToastOptions): string {
    return this.push('error', message, opts);
  }

  dismiss(id: string): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }

  private push(kind: ToastKind, message: string, opts?: ToastOptions): string {
    const id = `toast-${++this.seq}-${Date.now()}`;
    const defaultDuration = kind === 'error' ? 8000 : 4000;
    const durationMs = opts?.durationMs ?? defaultDuration;
    const toast: Toast = {
      id,
      kind,
      message,
      title: opts?.title,
      durationMs,
      createdAt: Date.now(),
    };

    this.toasts.update((list) => {
      const next = [...list, toast];
      return next.length > 5 ? next.slice(next.length - 5) : next;
    });

    if (durationMs > 0) {
      setTimeout(() => this.dismiss(id), durationMs);
    }

    return id;
  }
}
