#!/usr/bin/env node
// A scriptable fake browser.* MCP downstream for manual/integration testing
// of `rote-replay` against fixtures/playbooks/b1-download-report.yaml and
// b2-vendor-registration.yaml. Plain JS, no build step — same rationale as
// packages/recorder/test/fixtures/fake-downstream.mjs.
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, terminal: false });
const inputValues = {};

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

rl.on('line', (line) => {
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }
  if (msg.method !== 'tools/call') return;
  const { name, arguments: args = {} } = msg.params ?? {};

  switch (name) {
    case 'browser.navigate':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { url: args.url, visible_selectors: ['#login-form', '#registration-form'] },
      });
      break;
    case 'browser.fill':
      inputValues[args.selector] = args.value;
      send({ jsonrpc: '2.0', id: msg.id, result: { input_values: { [args.selector]: args.value } } });
      break;
    case 'browser.click':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { visible_selectors: ['#dashboard', '#registration-confirmation'] },
      });
      break;
    case 'browser.download_file':
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: { text: 'Download complete', file: 'report.pdf', bytes: 128 },
      });
      break;
    default:
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown tool "${name}"` } });
  }
});
