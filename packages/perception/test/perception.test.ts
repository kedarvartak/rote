import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { captureStaticHtml, findChromeExecutable, FixtureSiteServer, LaunchingCdpBrowserBackend } from '@rote/browser';
import { distillPage, renderObservation } from '../src/index.js';

let servers: FixtureSiteServer[] = [];
let backends: LaunchingCdpBrowserBackend[] = [];

afterEach(async () => {
  await Promise.all(backends.map((backend) => backend.close()));
  backends = [];
  await Promise.all(servers.map((server) => server.close()));
  servers = [];
});

function fixture(name: string) {
  const path = resolve('../../fixtures/sites', name);
  return captureStaticHtml(path, readFileSync(path, 'utf8'));
}

describe('distillPage', () => {
  it('keeps interactive and content-bearing nodes from B2', () => {
    const nodes = distillPage(fixture('b2-vendor-form.html'));

    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'textbox', name: 'company_name', selectorHint: '#company-name', interactive: true }),
        expect.objectContaining({ role: 'combobox', name: 'country', selectorHint: '#country', interactive: true }),
        expect.objectContaining({ role: 'button', name: 'Submit registration', selectorHint: '#registration-submit', interactive: true }),
      ]),
    );
  });

  it('keeps stable IDs across selector and irrelevant attribute changes', () => {
    const base = captureStaticHtml('mem://base', '<button id="submit" class="a">Submit</button>');
    const changed = captureStaticHtml('mem://base', '<button id="submit-v2" class="b" data-random="1">Submit</button>');

    expect(distillPage(changed)[0]?.id).toEqual(distillPage(base)[0]?.id);
  });

  it('distills a CDP-captured fixture page', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    if (!chromePath) return;
    const server = new FixtureSiteServer({ rootDir: resolve('../../fixtures/sites') });
    servers.push(server);
    await server.start();
    const backend = new LaunchingCdpBrowserBackend({ chromePath });
    backends.push(backend);

    const nodes = distillPage(await backend.capture(server.url('b2-vendor-form.html')));

    expect(nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'textbox', selectorHint: '#company-name', interactive: true }),
        expect.objectContaining({ role: 'button', selectorHint: '#registration-submit', interactive: true }),
      ]),
    );
  }, 30000);
});

describe('renderObservation', () => {
  it('renders compact observations smaller than raw HTML', () => {
    const page = fixture('b3-catalog.html');
    const rendered = renderObservation(distillPage(page));

    expect(rendered.text).toContain('#catalog-query');
    expect(rendered.text.length).toBeLessThan(page.html.length);
    expect(rendered.approxTokens).toBeGreaterThan(0);
  });

  it('honors a hard character budget', () => {
    const rendered = renderObservation(distillPage(fixture('b2-vendor-form.html')), { maxChars: 120 });

    expect(rendered.text.length).toBeLessThanOrEqual(120);
    expect(rendered.truncated).toBe(true);
  });
});
