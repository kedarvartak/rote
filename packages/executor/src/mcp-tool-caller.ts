import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import { isResponse, tryParseJsonRpcLine, type JsonRpcResponse } from '@rote/recorder';
import type { ToolCallOutcome, ToolCaller } from './tool-caller.js';

export interface McpToolCallerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * A real (non-tee) MCP client: spawns a downstream server and makes actual
 * `tools/call` request/response round-trips, unlike the recorder's proxy
 * which only observes traffic between someone else's client and server.
 * Reuses @rote/recorder's JSON-RPC line-parsing primitives rather than
 * re-implementing them.
 */
export class McpToolCaller implements ToolCaller {
  private readonly child: ChildProcess;
  private nextId = 1;
  private readonly pending = new Map<number, (reply: Pick<JsonRpcResponse, 'result' | 'error'>) => void>();

  constructor(config: McpToolCallerConfig) {
    this.child = spawn(config.command, config.args ?? [], {
      stdio: ['pipe', 'pipe', 'inherit'],
      env: { ...process.env, ...config.env },
    });
    if (!this.child.stdin || !this.child.stdout) {
      throw new Error(`failed to open stdio for downstream command "${config.command}"`);
    }
    createInterface({ input: this.child.stdout, terminal: false }).on('line', (line) => {
      const msg = tryParseJsonRpcLine(line);
      if (!msg || !isResponse(msg) || typeof msg.id !== 'number') return;
      const resolve = this.pending.get(msg.id);
      if (!resolve) return;
      this.pending.delete(msg.id);
      resolve({ result: msg.result, error: msg.error });
    });
  }

  async call(tool: string, args: Record<string, unknown>): Promise<ToolCallOutcome> {
    const id = this.nextId;
    this.nextId += 1;
    const reply = new Promise<Pick<JsonRpcResponse, 'result' | 'error'>>((resolve) => {
      this.pending.set(id, resolve);
    });
    this.child.stdin?.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name: tool, arguments: args } })}\n`,
    );
    const { result, error } = await reply;
    if (error) {
      return { ok: false, error: { message: error.message, code: String(error.code) } };
    }
    return { ok: true, result };
  }

  /** Ends the downstream process's stdin so it can exit cleanly. */
  async close(): Promise<void> {
    this.child.stdin?.end();
  }
}
