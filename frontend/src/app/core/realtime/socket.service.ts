import { DestroyRef, Injectable, InjectionToken, inject, signal } from '@angular/core';
import {
  ClientToServerEvents,
  MiddlemanChunkEvent,
  ServerToClientEvents,
  WS_NAMESPACE,
} from '@forge/shared';
import { Socket, io } from 'socket.io-client';

export const WS_URL = new InjectionToken<string>('WS_URL', {
  providedIn: 'root',
  factory: () => '',
});

@Injectable({ providedIn: 'root' })
export class SocketService {
  private readonly socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(
    `${inject(WS_URL)}${WS_NAMESPACE}`,
    {
      transports: ['websocket'],
      autoConnect: true,
      reconnectionDelayMax: 5000,
    },
  );
  readonly connected = signal(false);
  private readonly projectRooms = new Set<string>();
  private readonly reconnectHandlers: Array<() => void> = [];

  constructor() {
    this.socket.on('connect', () => {
      this.connected.set(true);
      this.projectRooms.forEach((id) =>
        this.socket.emit('studio:subscribe-project', { projectId: id }, () => undefined),
      );
      this.reconnectHandlers.forEach((h) => h());
    });
    this.socket.on('disconnect', () => this.connected.set(false));
    inject(DestroyRef).onDestroy(() => this.socket.disconnect());
  }

  on<E extends keyof ServerToClientEvents>(
    event: E,
    handler: ServerToClientEvents[E],
  ): () => void {
    this.socket.on(event, handler as never);
    return () => this.socket.off(event, handler as never);
  }

  subscribeProject(id: string): void {
    this.projectRooms.add(id);
    this.socket.emit('studio:subscribe-project', { projectId: id }, () => undefined);
  }

  unsubscribeProject(id: string): void {
    this.projectRooms.delete(id);
    this.socket.emit('studio:unsubscribe-project', { projectId: id }, () => undefined);
  }

  subscribeJob(jobId: string, onReplay: (r: MiddlemanChunkEvent[]) => void): void {
    this.socket.emit('job:subscribe', { jobId }, (a) => a.replay && onReplay(a.replay));
  }

  onReconnect(h: () => void): void {
    this.reconnectHandlers.push(h);
  }
}
