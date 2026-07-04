import { describe, expect, it } from 'vitest';
import { isRequest, isResponse, tryParseJsonRpcLine } from '../src/jsonrpc.js';

describe('tryParseJsonRpcLine', () => {
  it('parses a request', () => {
    const msg = tryParseJsonRpcLine('{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"echo"}}');
    expect(msg).toBeDefined();
    expect(msg && isRequest(msg)).toBe(true);
  });

  it('parses a success response', () => {
    const msg = tryParseJsonRpcLine('{"jsonrpc":"2.0","id":1,"result":{"ok":true}}');
    expect(msg).toBeDefined();
    expect(msg && isResponse(msg)).toBe(true);
  });

  it('parses an error response', () => {
    const msg = tryParseJsonRpcLine('{"jsonrpc":"2.0","id":1,"error":{"code":-1,"message":"boom"}}');
    expect(msg).toBeDefined();
    expect(msg && isResponse(msg)).toBe(true);
  });

  it('returns undefined for a notification (no id)', () => {
    expect(tryParseJsonRpcLine('{"jsonrpc":"2.0","method":"notifications/progress"}')).toBeUndefined();
  });

  it('returns undefined for invalid JSON, never throws', () => {
    expect(() => tryParseJsonRpcLine('not json at all')).not.toThrow();
    expect(tryParseJsonRpcLine('not json at all')).toBeUndefined();
  });

  it('returns undefined for a blank line', () => {
    expect(tryParseJsonRpcLine('')).toBeUndefined();
    expect(tryParseJsonRpcLine('   ')).toBeUndefined();
  });

  it('returns undefined for a non-JSON-RPC object', () => {
    expect(tryParseJsonRpcLine('{"id":1,"foo":"bar"}')).toBeUndefined();
  });

  it('returns undefined for a JSON array line', () => {
    expect(tryParseJsonRpcLine('[1,2,3]')).toBeUndefined();
  });
});
