import { Injectable } from '@angular/core';

export interface PlayOptions {
  offset?: number;
  loop?: boolean;
  loopStart?: number;
  loopEnd?: number;
  gain?: number;
  group?: string;
  onEnded?: () => void;
}

export interface PlaybackHandle {
  stop: () => void;
  currentTime: () => number;
  setLoop: (on: boolean) => void;
  setGain: (gain: number) => void;
  readonly duration: number;
}

interface CacheEntry {
  url: string;
  buffer: AudioBuffer;
  bytes: number;
}

@Injectable({ providedIn: 'root' })
export class AudioEngineService {
  private ctx: AudioContext | null = null;
  private readonly cache: CacheEntry[] = [];
  private cacheBytes = 0;
  private readonly maxEntries = 24;
  private readonly maxBytes = 300 * 1024 * 1024;
  private exclusiveHandle: PlaybackHandle | null = null;

  getContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext();
    }
    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  async decode(url: string): Promise<AudioBuffer> {
    const existingIdx = this.cache.findIndex((c) => c.url === url);
    if (existingIdx !== -1) {
      const hit = this.cache.splice(existingIdx, 1)[0]!;
      this.cache.push(hit);
      return hit.buffer;
    }

    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`Failed to fetch audio (${res.status})`);
    }
    const arrayBuf = await res.arrayBuffer();
    const ctx = this.getContext();
    const audioBuf = await ctx.decodeAudioData(arrayBuf.slice(0));
    const bytes = audioBuf.length * audioBuf.numberOfChannels * 4;

    while (
      this.cache.length > 0 &&
      (this.cache.length >= this.maxEntries || this.cacheBytes + bytes > this.maxBytes)
    ) {
      const evicted = this.cache.shift();
      if (evicted) {
        this.cacheBytes -= evicted.bytes;
      }
    }

    this.cache.push({ url, buffer: audioBuf, bytes });
    this.cacheBytes += bytes;
    return audioBuf;
  }

  play(buffer: AudioBuffer, opts: PlayOptions = {}): PlaybackHandle {
    const ctx = this.getContext();
    if (!opts.group && this.exclusiveHandle) {
      this.exclusiveHandle.stop();
      this.exclusiveHandle = null;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = Boolean(opts.loop);
    if (opts.loopStart !== undefined) {
      source.loopStart = opts.loopStart;
    }
    if (opts.loopEnd !== undefined) {
      source.loopEnd = opts.loopEnd;
    }

    const gainNode = ctx.createGain();
    gainNode.gain.value = opts.gain ?? 1;
    source.connect(gainNode);
    gainNode.connect(ctx.destination);

    const startOffset = Math.max(0, Math.min(buffer.duration, opts.offset ?? 0));
    const startedAtCtxTime = ctx.currentTime;
    let stopped = false;

    source.onended = () => {
      if (!stopped) {
        stopped = true;
        if (this.exclusiveHandle === handle) {
          this.exclusiveHandle = null;
        }
        opts.onEnded?.();
      }
    };

    source.start(0, startOffset);

    const handle: PlaybackHandle = {
      duration: buffer.duration,
      stop: () => {
        if (stopped) return;
        stopped = true;
        try {
          source.stop();
        } catch {
          // already stopped
        }
        source.disconnect();
        gainNode.disconnect();
        if (this.exclusiveHandle === handle) {
          this.exclusiveHandle = null;
        }
      },
      currentTime: () => {
        if (stopped) return startOffset;
        const elapsed = ctx.currentTime - startedAtCtxTime + startOffset;
        if (source.loop && buffer.duration > 0) {
          const loopStart = source.loopStart || 0;
          const loopEnd = source.loopEnd && source.loopEnd > loopStart ? source.loopEnd : buffer.duration;
          const span = loopEnd - loopStart;
          if (elapsed >= loopStart && span > 0) {
            return loopStart + ((elapsed - loopStart) % span);
          }
        }
        return Math.min(buffer.duration, elapsed);
      },
      setLoop: (on: boolean) => {
        source.loop = on;
      },
      setGain: (gain: number) => {
        gainNode.gain.value = Math.max(0, Math.min(2, gain));
      },
    };

    if (!opts.group) {
      this.exclusiveHandle = handle;
    }

    return handle;
  }
}
