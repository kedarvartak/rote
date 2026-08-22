import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveActionContract } from '@rote/action';
import { captureStaticHtml, findChromeExecutable, FixtureSiteServer, LaunchingCdpBrowserBackend, type CdpPage } from '@rote/browser';
import { distillPage, stableNodeRef } from '@rote/perception';
import { BrowserToolCaller } from '../src/index.js';

// see docs/03-benchmark.md B4 — the triage fixture's deterministic control run.
// This pins the fixture itself (real Chrome reaches the exact confirmation with
// zero LLM calls) and that static and CDP captures agree on the select/submit
// contracts, so a recorded B4 run carries the contracts the distiller's
// judgment gate is tested against.

let server: FixtureSiteServer | undefined;
let backend: LaunchingCdpBrowserBackend | undefined;
let pages: CdpPage[] = [];

afterEach(async () => {
  for (const page of pages) page.close();
  pages = [];
  await backend?.close();
  backend = undefined;
  await server?.close();
  server = undefined;
});

describe('B4 triage fixture control (real Chrome, zero LLM)', () => {
  it('routes a known item to the exact confirmation and derives identical contracts from static and CDP captures', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    if (!chromePath) return;
    server = new FixtureSiteServer({ rootDir: resolve('../../fixtures/sites') });
    await server.start();
    backend = new LaunchingCdpBrowserBackend({ chromePath });
    const page = await backend.openPage();
    pages.push(page);

    const url = `${server.url('b4-triage.html')}?item=TKT-1041`;
    await page.navigate(url);
    const cdpNodes = distillPage(await page.capture());
    const staticNodes = distillPage(captureStaticHtml(url, await readFile(resolve('../../fixtures/sites/b4-triage.html'), 'utf8')));
    const pick = (nodes: typeof cdpNodes, selector: string) => nodes.find((node) => node.selectorHint === selector)!;
    const recordedSelect = deriveActionContract({ verb: 'select', node: pick(staticNodes, '#triage-category') });
    const recordedRoute = deriveActionContract({ verb: 'click', node: pick(staticNodes, '#triage-route') });
    expect(deriveActionContract({ verb: 'select', node: pick(cdpNodes, '#triage-category') })).toEqual(recordedSelect);
    expect(deriveActionContract({ verb: 'click', node: pick(cdpNodes, '#triage-route') })).toEqual(recordedRoute);

    // The item body the judgment reads is on the page before any action.
    expect(await page.evaluate<string>(`document.querySelector('#triage-item-body').textContent`)).toContain('refund of the duplicate payment');

    const caller = new BrowserToolCaller(page);
    const selectArgs = { selector: '#triage-category', stableId: stableNodeRef(pick(staticNodes, '#triage-category').id), role: 'combobox', name: 'Category', value: 'billing', contract: recordedSelect };
    const routeArgs = { selector: '#triage-route', stableId: stableNodeRef(pick(staticNodes, '#triage-route').id), role: 'button', name: 'Route item', contract: recordedRoute };
    expect(await caller.call('browser.select', selectArgs)).toMatchObject({ ok: true, result: { action_contract: { compatible: true } } });
    expect(await caller.call('browser.click', routeArgs)).toMatchObject({ ok: true });

    // Exact confirmation — the external oracle the run is judged by.
    expect(await page.evaluate<string>(`document.querySelector('#triage-summary').textContent`)).toBe('Item routed | item=TKT-1041 | category=billing');
    expect(await page.evaluate<boolean>(`document.querySelector('#triage-confirmation').hidden`)).toBe(false);
  }, 60_000);
});
