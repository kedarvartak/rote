import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve(process.argv[2] ?? '');
const port = Number(process.argv[3] ?? 8094);
if (!process.argv[2] || !Number.isInteger(port) || port < 1) {
  throw new Error('usage: node serve-directory.mjs <fixture-directory> [port]');
}
const types = { '.html': 'text/html; charset=utf-8', '.json': 'application/json; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = createServer((request, response) => {
  const pathname = decodeURIComponent((request.url ?? '/').split('?')[0]).replace(/^\/+/, '');
  const path = resolve(root, pathname || 'index.html');
  if (!path.startsWith(`${root}${sep}`)) return void response.writeHead(403).end();
  readFile(path).then(
    (body) => response.writeHead(200, { 'content-type': types[extname(path)] ?? 'application/octet-stream' }).end(body),
    () => response.writeHead(404).end(),
  );
});
server.listen(port, '127.0.0.1', () => console.log(`demo fixture: ${root} at http://127.0.0.1:${port}`));
