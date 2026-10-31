import { Injectable, signal } from '@angular/core';

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  extraAction?: string;
}

export type ConfirmDialogResult = 'confirm' | 'cancel' | 'extra';

interface ActiveConfirmState extends ConfirmDialogOptions {
  resolve: (res: ConfirmDialogResult) => void;
}

@Injectable({ providedIn: 'root' })
export class ConfirmDialogService {
  readonly activeDialog = signal<ActiveConfirmState | null>(null);

  confirm(opts: ConfirmDialogOptions): Promise<ConfirmDialogResult> {
    return new Promise<ConfirmDialogResult>((resolve) => {
      this.activeDialog.set({ ...opts, resolve });
    });
  }

  respond(result: ConfirmDialogResult): void {
    const cur = this.activeDialog();
    if (!cur) return;
    this.activeDialog.set(null);
    cur.resolve(result);
  }
}
