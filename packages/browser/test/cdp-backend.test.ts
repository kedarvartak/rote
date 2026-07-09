import { createServer, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findChromeExecutable, LaunchingCdpBrowserBackend } from '../src/index.js';

let servers: Server[] = [];
let backends: LaunchingCdpBrowserBackend[] = [];

afterEach(async () => {
  await Promise.all(backends.map((backend) => backend.close()));
  backends = [];
  await Promise.all(servers.map((server) => new Promise<void>((resolveClose) => server.close(() => resolveClose()))));
  servers = [];
});

describe('LaunchingCdpBrowserBackend', () => {
  it('captures a live local fixture page through Chrome DevTools Protocol', async () => {
    const chromePath = findChromeExecutable();
    if (!chromePath) return;
    const origin = await serveFixture('b1-report.html');
    const backend = new LaunchingCdpBrowserBackend({ chromePath });
    backends.push(backend);

    const page = await backend.capture(`${origin}/b1-report.html`);

    expect(page.url).toBe(`${origin}/b1-report.html`);
    expect(page.title).toBe('Reports Portal');
    expect(page.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: 'input', attributes: expect.objectContaining({ id: 'username' }) }),
        expect.objectContaining({ tag: 'button', attributes: expect.objectContaining({ id: 'latest-report-download' }) }),
      ]),
    );
  }, 20000);
});

async function serveFixture(fileName: string): Promise<string> {
  const html = await readFile(resolve('../../fixtures/sites', fileName), 'utf8');
  const server = createServer((req, res) => {
    if (req.url !== `/${fileName}`) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(html);
  });
  servers.push(server);
  await new Promise<void>((resolveListen) => server.listen(0, '127.0.0.1', () => resolveListen()));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server did not bind to a TCP port');
  return `http://127.0.0.1:${address.port}`;
}
