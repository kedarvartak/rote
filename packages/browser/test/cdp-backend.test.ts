import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CapturedPageSchema, findChromeExecutable, FixtureSiteServer, LaunchingCdpBrowserBackend } from '../src/index.js';

let servers: FixtureSiteServer[] = [];
let backends: LaunchingCdpBrowserBackend[] = [];

afterEach(async () => {
  await Promise.all(backends.map((backend) => backend.close()));
  backends = [];
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

describe('LaunchingCdpBrowserBackend', () => {
  it('captures B1-B3 fixture pages through Chrome DevTools Protocol', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    if (!chromePath) return;
    const server = await serveFixtures();
    const backend = new LaunchingCdpBrowserBackend({ chromePath });
    backends.push(backend);

    const pages = await Promise.all([
      backend.capture(server.url('b1-report.html')),
      backend.capture(server.url('b2-vendor-form.html')),
      backend.capture(server.url('b3-catalog.html')),
    ]);

    for (const page of pages) expect(CapturedPageSchema.parse(page)).toEqual(page);
    expect(pages[0]).toEqual(
      expect.objectContaining({
        url: server.url('b1-report.html'),
        title: 'Reports Portal',
        elements: expect.arrayContaining([
          expect.objectContaining({ tag: 'input', attributes: expect.objectContaining({ id: 'username' }) }),
          expect.objectContaining({ tag: 'button', attributes: expect.objectContaining({ id: 'latest-report-download' }) }),
        ]),
      }),
    );
    expect(pages[1]?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: 'input', attributes: expect.objectContaining({ id: 'company-name' }) }),
        expect.objectContaining({ tag: 'select', attributes: expect.objectContaining({ id: 'country' }) }),
      ]),
    );
    expect(pages[2]?.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tag: 'input', attributes: expect.objectContaining({ id: 'catalog-query' }) }),
        expect.objectContaining({ tag: 'button', attributes: expect.objectContaining({ id: 'catalog-search-submit' }) }),
      ]),
    );
  }, 30000);
});

async function serveFixtures(): Promise<FixtureSiteServer> {
  const server = new FixtureSiteServer({ rootDir: resolve('../../fixtures/sites') });
  servers.push(server);
  await server.start();
  return server;
}
