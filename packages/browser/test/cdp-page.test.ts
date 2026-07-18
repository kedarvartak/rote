import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findChromeExecutable, FixtureSiteServer, LaunchingCdpBrowserBackend, type CdpPage } from '../src/index.js';

let servers: FixtureSiteServer[] = [];
let backends: LaunchingCdpBrowserBackend[] = [];
let pages: CdpPage[] = [];

afterEach(async () => {
  for (const page of pages) page.close();
  pages = [];
  await Promise.all(backends.map((backend) => backend.close()));
  backends = [];
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

describe('CdpPage', () => {
  it('navigates, fills fields, selects options, clicks elements, and recaptures state', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    if (!chromePath) return;
    const server = await serveFixtures();
    const backend = new LaunchingCdpBrowserBackend({ chromePath });
    backends.push(backend);
    const page = await backend.openPage();
    pages.push(page);

    await page.navigate(server.url('b2-vendor-form.html'));
    const initialActivity = await page.sampleActivity();
    await page.evaluate<void>('document.body.append(document.createElement("aside"))');
    const changedActivity = await page.sampleActivity();
    expect(Number.isInteger(initialActivity.pendingRequests)).toBe(true);
    expect(changedActivity.mutationVersion).toBeGreaterThan(initialActivity.mutationVersion);
    await page.fill('#company-name', 'Acme Tools');
    await page.fill('#contact-email', 'ops@example.com');
    await page.select('#country', 'US');

    expect(await page.evaluate<string>('document.querySelector("#company-name").value')).toBe('Acme Tools');
    expect(await page.evaluate<string>('document.querySelector("#contact-email").value')).toBe('ops@example.com');
    expect(await page.evaluate<string>('document.querySelector("#country").value')).toBe('US');

    const captured = await page.capture();
    expect(captured.url).toBe(server.url('b2-vendor-form.html'));
    expect(captured.elements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tag: 'input',
          attributes: expect.objectContaining({ id: 'company-name', value: 'Acme Tools', 'data-rote-visible': 'true' }),
        }),
        expect.objectContaining({
          tag: 'button',
          attributes: expect.objectContaining({ id: 'registration-submit', 'data-rote-visible': 'true' }),
        }),
      ]),
    );

    await page.navigate(server.url('b3-catalog.html'));
    await page.evaluate<void>('document.querySelector("#catalog-search-submit").addEventListener("click", (event) => { event.preventDefault(); document.body.dataset.clicked = "yes"; })');
    await page.click('#catalog-search-submit');

    expect(await page.evaluate<string>('document.body.dataset.clicked')).toBe('yes');
  }, 30000);
});

async function serveFixtures(): Promise<FixtureSiteServer> {
  const server = new FixtureSiteServer({ rootDir: resolve('../../fixtures/sites') });
  servers.push(server);
  await server.start();
  return server;
}
