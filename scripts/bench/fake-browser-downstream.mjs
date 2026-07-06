#!/usr/bin/env node
import { createInterface } from 'node:readline';

const rl = createInterface({ input: process.stdin, terminal: false });
const inputValues = {};

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

function ok(id, result) {
  send({ jsonrpc: '2.0', id, result });
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
      ok(msg.id, {
        url: args.url,
        visible_selectors: ['#login-form', '#registration-form', '#search-form', '#catalog-results'],
        visible_text: ['Ready'],
      });
      break;
    case 'browser.fill':
      inputValues[args.selector] = args.value;
      ok(msg.id, { input_values: { [args.selector]: args.value } });
      break;
    case 'browser.click':
      ok(msg.id, {
        visible_selectors: ['#dashboard', '#registration-confirmation', '#catalog-results'],
        visible_text: ['Registration submitted', 'Search complete'],
      });
      break;
    case 'browser.download_file':
      ok(msg.id, { text: 'Download complete', file: 'report.pdf', bytes: 128 });
      break;
    case 'browser.extract':
      ok(msg.id, {
        items: [
          { name: 'Alpha result', rank: 1 },
          { name: 'Beta result', rank: 2 },
          { name: 'Gamma result', rank: 3 },
        ],
        count: 3,
        visible_text: ['Search complete'],
      });
      break;
    default:
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown tool "${name}"` } });
  }
});
