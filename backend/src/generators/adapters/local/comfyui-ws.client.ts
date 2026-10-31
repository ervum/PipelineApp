import WebSocket from 'ws';

export interface ComfyUiPromptState {
  promptId: string | null;
  progressPercent: number;
  finished: boolean;
  error: string | null;
  connected: boolean;
}

interface ComfyWsMessage {
  type?: string;
  data?: {
    prompt_id?: string;
    value?: number;
    max?: number;
    node?: string | null;
    exception_message?: string;
  };
}

export class ComfyUiWsClient {
  private ws: WebSocket | null = null;
  private state: ComfyUiPromptState = {
    promptId: null,
    progressPercent: 0,
    finished: false,
    error: null,
    connected: false,
  };

  constructor(
    private readonly wsUrl: string,
    private readonly onProgress?: (percent: number, stage: string) => void,
  ) {}

  async connect(timeoutMs = 3_000): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const done = (ok: boolean): void => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };

      const timer = setTimeout(() => {
        done(false);
      }, timeoutMs);
      timer.unref?.();

      try {
        const socket = new WebSocket(this.wsUrl);
        this.ws = socket;

        socket.on('open', () => {
          this.state.connected = true;
          clearTimeout(timer);
          done(true);
        });

        socket.on('message', (data: WebSocket.RawData, isBinary: boolean) => {
          if (isBinary) return;
          try {
            const msg = JSON.parse(data.toString('utf8')) as ComfyWsMessage;
            this.handleMessage(msg);
          } catch {
            // Ignore non-JSON frame
          }
        });

        socket.on('error', () => {
          this.state.connected = false;
          clearTimeout(timer);
          done(false);
        });

        socket.on('close', () => {
          this.state.connected = false;
          clearTimeout(timer);
          done(false);
        });
      } catch {
        clearTimeout(timer);
        done(false);
      }
    });
  }

  setPromptId(promptId: string): void {
    this.state.promptId = promptId;
  }

  getState(): ComfyUiPromptState {
    return { ...this.state };
  }

  close(): void {
    if (this.ws) {
      try {
        this.ws.close();
      } catch {
        // Ignore close errors
      }
      this.ws = null;
    }
    this.state.connected = false;
  }

  private handleMessage(msg: ComfyWsMessage): void {
    const promptId = msg.data?.prompt_id;
    if (this.state.promptId && promptId && promptId !== this.state.promptId) {
      return;
    }

    if (msg.type === 'progress') {
      const value = msg.data?.value ?? 0;
      const max = msg.data?.max ?? 1;
      if (max > 0) {
        const pct = Math.max(0, Math.min(99, Math.round((value / max) * 100)));
        this.state.progressPercent = pct;
        this.onProgress?.(pct, 'sampling');
      }
    } else if (msg.type === 'executing') {
      if (msg.data?.node === null) {
        this.state.finished = true;
        this.state.progressPercent = 100;
      }
    } else if (msg.type === 'execution_error') {
      this.state.error =
        msg.data?.exception_message || 'ComfyUI execution_error';
    }
  }
}
