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
        expect.objectContaining({ role: 'textbox', name: 'Company name', selectorHint: '#company-name', interactive: true }),
        expect.objectContaining({ role: 'combobox', name: 'Country', selectorHint: '#country', interactive: true }),
        expect.objectContaining({ role: 'button', name: 'Submit registration', selectorHint: '#registration-submit', interactive: true }),
      ]),
    );
  });

  it('uses associated labels and aria-labelledby before machine-oriented names', () => {
    const page = captureStaticHtml('mem://labels', `
      <label for="email">Contact email</label><input id="email" name="contact_email" />
      <span id="save-label">Save vendor</span><button id="save" aria-labelledby="save-label">Save</button>
    `);
    const nodes = distillPage(page);

    expect(nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ selectorHint: '#email', name: 'Contact email' }),
      expect.objectContaining({ selectorHint: '#save', name: 'Save vendor' }),
    ]));
    expect(nodes.filter((node) => node.name === 'Contact email')).toHaveLength(1);
  });

  it('prunes hidden controls, empty content, and duplicate non-interactive text', () => {
    const nodes = distillPage(captureStaticHtml('mem://noise', `
      <button id="hidden" style="display:none">Danger</button>
      <input id="secret" type="hidden" value="token" />
      <label></label><p>Repeated help</p><p>Repeated help</p>
      <button id="visible">Continue</button>
    `));

    expect(nodes.some((node) => node.selectorHint === '#hidden')).toBe(false);
    expect(nodes.some((node) => node.selectorHint === '#secret')).toBe(false);
    expect(nodes.filter((node) => node.name === 'Repeated help')).toHaveLength(1);
    expect(nodes.some((node) => node.selectorHint === '#visible')).toBe(true);
  });

  it('preserves live checkbox state as diffable observation data', () => {
    const unchecked = distillPage(captureStaticHtml('mem://checks', '<input id="row" type="checkbox" />'));
    const checked = distillPage(captureStaticHtml('mem://checks', '<input id="row" type="checkbox" checked />'));

    expect(unchecked[0]).toEqual(expect.objectContaining({ state: { checked: false } }));
    expect(checked[0]).toEqual(expect.objectContaining({
      id: unchecked[0]?.id,
      state: { checked: true },
    }));
    expect(renderObservation(checked).text).toContain('checked=true');
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
        expect.objectContaining({ role: 'textbox', name: 'Company name', selectorHint: '#company-name', interactive: true }),
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
