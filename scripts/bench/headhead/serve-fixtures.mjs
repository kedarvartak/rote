// Serves fixtures/sites on a fixed port so both harnesses in the head-to-head hit
// the byte-identical frozen pages (docs/03 "do not benchmark against a drifting
// dev portal"). The port is fixed — not random as in tests — because the Rote plan
// and the Browser Use runner are separate processes that must agree on the origin.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { extname, resolve, sep } from 'node:path';

const rootDir = resolve(fileURLToPath(new URL('../../../fixtures/sites', import.meta.url)));
const port = Number(process.argv[2] ?? 8080);
if (!Number.isInteger(port) || port < 1) throw new Error('usage: node serve-fixtures.mjs [port]');

const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };

const server = createServer((req, res) => {
  const path = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '');
  const filePath = resolve(rootDir, path || 'index.html');
  if (!filePath.startsWith(`${rootDir}${sep}`)) {
    res.writeHead(403).end();
    return;
  }
  readFile(filePath).then(
    (body) => res.writeHead(200, { 'content-type': types[extname(filePath)] ?? 'application/octet-stream' }).end(body),
    () => res.writeHead(404).end(),
  );
});

server.listen(port, '127.0.0.1', () => {
  console.log(`serving ${rootDir} on http://127.0.0.1:${port}`);
});
