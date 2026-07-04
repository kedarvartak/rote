import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { PassThrough } from 'node:stream';
import { runProxy, type ProxyConfig } from '../../src/proxy.js';

interface JsonRpcReply {
  result?: unknown;
  error?: { code: number; message: string };
}

export interface ProxySession {
  call(name: string, args?: Record<string, unknown>): Promise<JsonRpcReply>;
  listTools(): Promise<JsonRpcReply>;
  /** Ends the client stream and awaits the proxy session finishing. */
  close(): Promise<void>;
  /** Resolves when the proxy session ends, however it ends. */
  done: Promise<void>;
}

/**
 * Drives a `runProxy` session over in-memory streams standing in for a real
 * MCP client's stdio, so tests exercise the real proxy/tee logic without a
 * second real process on the client side (only the downstream is a real
 * child process — see fixtures/fake-downstream.mjs).
 */
export function startProxySession(config: ProxyConfig): ProxySession {
  const toProxy = new PassThrough();
  const fromProxy = new PassThrough();
  const pending = new Map<number, (reply: JsonRpcReply) => void>();
  let nextId = 1;

  createInterface({ input: fromProxy, terminal: false }).on('line', (line) => {
    let msg: { id: number; result?: unknown; error?: JsonRpcReply['error'] };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
    }
    const resolve = pending.get(msg.id);
    if (!resolve) return;
    pending.delete(msg.id);
    resolve({ result: msg.result, error: msg.error });
  });

  function send(method: string, params: unknown): Promise<JsonRpcReply> {
    const id = nextId;
    nextId += 1;
    const reply = new Promise<JsonRpcReply>((resolve) => pending.set(id, resolve));
    toProxy.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return reply;
  }

  const done = runProxy(config, toProxy, fromProxy);

  return {
    call: (name, args = {}) => send('tools/call', { name, arguments: args }),
    listTools: () => send('tools/list', {}),
    close: async () => {
      toProxy.end();
      await done;
    },
    done,
  };
}

export const FAKE_DOWNSTREAM_PATH = new URL('../fixtures/fake-downstream.mjs', import.meta.url).pathname;

/**
 * Speaks directly to a fake-downstream child process with no proxy in
 * between — the true baseline the overhead test compares against (spawning
 * a *second* proxy-wrapped session would measure proxy-vs-proxy, not
 * proxy-vs-nothing).
 */
export function startDirectSession(): ProxySession {
  const child = spawn(process.execPath, [FAKE_DOWNSTREAM_PATH], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map<number, (reply: JsonRpcReply) => void>();
  let nextId = 1;

  createInterface({ input: child.stdout, terminal: false }).on('line', (line) => {
    let msg: { id: number; result?: unknown; error?: JsonRpcReply['error'] };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
    }
    const resolve = pending.get(msg.id);
    if (!resolve) return;
    pending.delete(msg.id);
    resolve({ result: msg.result, error: msg.error });
  });

  function send(method: string, params: unknown): Promise<JsonRpcReply> {
    const id = nextId;
    nextId += 1;
    const reply = new Promise<JsonRpcReply>((resolve) => pending.set(id, resolve));
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    return reply;
  }

  const done = new Promise<void>((resolve) => child.on('exit', () => resolve()));

  return {
    call: (name, args = {}) => send('tools/call', { name, arguments: args }),
    listTools: () => send('tools/list', {}),
    close: async () => {
      child.stdin.end();
      await done;
    },
    done,
  };
}
