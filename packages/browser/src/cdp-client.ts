import { get, request } from 'node:http';

export interface CdpClientOptions {
  webSocketDebuggerUrl: string;
}

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

/** Minimal Chrome DevTools Protocol client for the capture-only V1 browser backend. */
export class CdpClient {
  private readonly socket: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCommand>();
  private readonly eventListeners = new Map<string, Set<(params: Record<string, unknown>) => void>>();

  private constructor(socket: WebSocket) {
    this.socket = socket;
    this.socket.addEventListener('message', (event) => {
      const msg = JSON.parse(String(event.data)) as {
        id?: number;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
        error?: { message?: string };
      };
      if (msg.method) {
        for (const listener of this.eventListeners.get(msg.method) ?? []) listener(msg.params ?? {});
      }
      if (typeof msg.id !== 'number') return;
      const pending = this.pending.get(msg.id);
      if (!pending) return;
      this.pending.delete(msg.id);
      if (msg.error) pending.reject(new Error(msg.error.message ?? 'CDP command failed'));
      else pending.resolve(msg.result);
    });
    this.socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP socket closed'));
      this.pending.clear();
    });
  }

  /** Connects to a page target's WebSocket debugger URL. */
  static async connect(options: CdpClientOptions): Promise<CdpClient> {
    const socket = new WebSocket(options.webSocketDebuggerUrl);
    await new Promise<void>((resolve, reject) => {
      socket.addEventListener('open', () => resolve(), { once: true });
      socket.addEventListener('error', () => reject(new Error('failed to open CDP websocket')), { once: true });
    });
    return new CdpClient(socket);
  }

  /** Sends one CDP command and returns its typed result. */
  async send<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId;
    this.nextId += 1;
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.socket.send(JSON.stringify({ id, method, params }));
    return (await response) as T;
  }

  /** Subscribes to one CDP event and returns an unsubscribe function. */
  onEvent(method: string, listener: (params: Record<string, unknown>) => void): () => void {
    const listeners = this.eventListeners.get(method) ?? new Set();
    listeners.add(listener);
    this.eventListeners.set(method, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.eventListeners.delete(method);
    };
  }

  /** Resolves once a CDP event with `method` arrives. */
  waitForEvent(method: string, timeoutMs = 5000): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.removeEventListener('message', onMessage);
        reject(new Error(`timed out waiting for CDP event ${method}`));
      }, timeoutMs);
      const onMessage = (event: MessageEvent) => {
        const msg = JSON.parse(String(event.data)) as { method?: string };
        if (msg.method !== method) return;
        clearTimeout(timeout);
        this.socket.removeEventListener('message', onMessage);
        resolve();
      };
      this.socket.addEventListener('message', onMessage);
    });
  }

  close(): void {
    this.socket.close();
  }
}

export interface CdpVersionInfo {
  webSocketDebuggerUrl?: string;
}

export interface CdpTargetInfo {
  webSocketDebuggerUrl?: string;
}

/** Reads `/json/version` from a CDP HTTP endpoint. */
export async function fetchCdpVersion(endpoint: string): Promise<CdpVersionInfo> {
  return getJson<CdpVersionInfo>(new URL('/json/version', endpoint));
}

/** Opens a fresh page target and returns its debugger URL. */
export async function createCdpTarget(endpoint: string, url = 'about:blank'): Promise<CdpTargetInfo> {
  const targetUrl = new URL('/json/new', endpoint);
  targetUrl.search = url;
  return requestJson<CdpTargetInfo>(targetUrl, 'PUT');
}

async function getJson<T>(url: URL): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(`CDP HTTP ${res.statusCode ?? 0}: ${body}`));
          return;
        }
        resolve(JSON.parse(body) as T);
      });
    }).on('error', reject);
  });
}

async function requestJson<T>(url: URL, method: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const req = request(url, { method }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        if ((res.statusCode ?? 500) >= 400) {
          reject(new Error(`CDP HTTP ${res.statusCode ?? 0}: ${body}`));
          return;
        }
        resolve(JSON.parse(body) as T);
      });
    });
    req.on('error', reject);
    req.end();
  });
}
