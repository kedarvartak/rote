/**
 * Minimal JSON-RPC 2.0 message classification for the proxy's tee logic.
 * Deliberately not a full client/server implementation (no dispatch, no
 * transport) — the proxy forwards every line byte-for-byte regardless of
 * whether it parses; these helpers only let it *also* notice the two request
 * kinds it records (`tools/call`, `tools/list`). A line that fails to parse
 * or doesn't look like JSON-RPC is simply not recorded, never dropped from
 * the forwarded stream (see proxy.ts).
 */

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse;

function hasId(value: Record<string, unknown>): value is Record<string, unknown> & { id: string | number } {
  return typeof value['id'] === 'string' || typeof value['id'] === 'number';
}

/** Parses one line as a JSON-RPC request or response; undefined if it isn't one. Never throws. */
export function tryParseJsonRpcLine(line: string): JsonRpcMessage | undefined {
  const trimmed = line.trim();
  if (trimmed.length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const obj = parsed as Record<string, unknown>;
  if (obj['jsonrpc'] !== '2.0' || !hasId(obj)) return undefined;

  if (typeof obj['method'] === 'string') {
    return { jsonrpc: '2.0', id: obj['id'], method: obj['method'], params: obj['params'] };
  }
  if ('result' in obj || 'error' in obj) {
    return {
      jsonrpc: '2.0',
      id: obj['id'],
      result: obj['result'],
      error: obj['error'] as JsonRpcResponse['error'],
    };
  }
  return undefined;
}

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return 'method' in msg;
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return !('method' in msg);
}
