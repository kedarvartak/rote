#!/usr/bin/env node
// A scriptable fake MCP downstream server for recorder tests. Speaks
// line-delimited JSON-RPC 2.0 over stdio. Deliberately outside src/ and
// plain JS (not TS) so tests can spawn it as a real child process without
// a build step — see docs/06-build-plan.md M1 "Fake-world first".
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, terminal: false });

const TOOLS = [
  { name: 'echo', inputSchema: { type: 'object', properties: {} } },
  { name: 'fail', inputSchema: { type: 'object', properties: {} } },
  { name: 'big', inputSchema: { type: 'object', properties: {} } },
];

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

rl.on('line', async (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } });
    return;
  }

  if (msg.method === 'tools/call') {
    const { name, arguments: args = {} } = msg.params ?? {};
    if (name === 'fail') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'boom' } });
      return;
    }
    if (name === 'big') {
      const size = args.size ?? 20000;
      send({ jsonrpc: '2.0', id: msg.id, result: { data: 'x'.repeat(size) } });
      return;
    }
    if (typeof args.delayMs === 'number') {
      await new Promise((resolve) => setTimeout(resolve, args.delayMs));
    }
    send({ jsonrpc: '2.0', id: msg.id, result: { echoed: args } });
  }
});

rl.on('close', () => process.exit(0));
