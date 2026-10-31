import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { MODALITY_META, Modality } from '@forge/shared';

@Injectable({ providedIn: 'root' })
export class NowService {
  readonly now = signal<number>(Date.now());

  constructor() {
    const timer = setInterval(() => {
      this.now.set(Date.now());
    }, 1000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }
}

const ROUTE_TO_MODALITY: Record<string, Modality> = {
  icons: 'ICONS_2D',
  '3d': 'ASSETS_3D',
  images: 'IMAGES',
  video: 'VIDEO',
  lore: 'LORE',
  music: 'MUSIC',
  voices: 'VOICES',
  sfx: 'SFX',
  other: 'OTHER',
};

export function modalityFromRoute(route: string | null | undefined): Modality {
  if (!route) return 'ICONS_2D';
  return ROUTE_TO_MODALITY[route.toLowerCase()] ?? 'ICONS_2D';
}

export function isValidModalityRoute(route: string | null | undefined): boolean {
  if (!route) return false;
  return Object.prototype.hasOwnProperty.call(ROUTE_TO_MODALITY, route.toLowerCase());
}

export function modalityFromUrl(url: string): Modality | null {
  const clean = url.split('?')[0]?.split('#')[0] ?? '';
  const match = /^\/generate\/([^/]+)/i.exec(clean);
  if (!match?.[1]) return null;
  return ROUTE_TO_MODALITY[match[1].toLowerCase()] ?? null;
}

export function routeForModality(modality: Modality): string {
  return MODALITY_META[modality].route;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let val = bytes;
  let unitIdx = 0;
  while (val >= 1024 && unitIdx < units.length - 1) {
    val /= 1024;
    unitIdx++;
  }
  return `${val >= 10 || unitIdx === 0 ? Math.round(val) : val.toFixed(1)} ${units[unitIdx]}`;
}

export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const mins = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${mins}m ${rem}s`;
}

export function formatSecondsClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const totalSec = Math.floor(seconds);
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function formatUsd(usd: number | null | undefined, decimals = 4): string {
  if (usd === null || usd === undefined || !Number.isFinite(usd)) return '$0.00';
  if (usd === 0) return '$0.00';
  return `$${usd.toFixed(decimals)}`;
}

export const formatCost = formatUsd;

export function formatRelativeTime(iso: string | null | undefined, nowMs = Date.now()): string {
  if (!iso) return 'never';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffSec = Math.max(0, Math.floor((nowMs - ts) / 1000));
  if (diffSec < 5) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export const formatRelative = formatRelativeTime;
