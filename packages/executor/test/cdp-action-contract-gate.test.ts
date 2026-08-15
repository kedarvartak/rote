import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { deriveActionContract } from '@rote/action';
import { captureStaticHtml, findChromeExecutable, FixtureSiteServer, LaunchingCdpBrowserBackend, type CdpPage } from '@rote/browser';
import { distillPage, stableNodeRef } from '@rote/perception';
import { BrowserToolCaller } from '../src/index.js';

// see docs/02 "Structural action-contract drift" (#143) — the recorded contract
// comes from whichever capture recorded the run (static or CDP), and replay
// derives the live one through CDP. This suite pins that both derivations agree
// on the frozen B2 form and that the CDP gate stops the adversarial variants
// before dispatch in a real browser.

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

describe('CDP action contract gate', () => {
  it('derives identical contracts from static and CDP captures and refuses mismatched variants without dispatch', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    const chromePath = findChromeExecutable();
    if (!chromePath) return;
    server = new FixtureSiteServer({ rootDir: resolve('../../fixtures/sites') });
    await server.start();
    backend = new LaunchingCdpBrowserBackend({ chromePath });
    const page = await backend.openPage();
    pages.push(page);

    const baseUrl = server.url('b2-vendor-form.html');
    await page.navigate(baseUrl);
    const cdpNodes = distillPage(await page.capture());
    const staticNodes = distillPage(captureStaticHtml(baseUrl, await readFile(resolve('../../fixtures/sites/b2-vendor-form.html'), 'utf8')));
    const pick = (nodes: typeof cdpNodes, selector: string) => nodes.find((node) => node.selectorHint === selector)!;
    const recordedFill = deriveActionContract({ verb: 'fill', node: pick(staticNodes, '#company-name') });
    const recordedSubmit = deriveActionContract({ verb: 'click', node: pick(staticNodes, '#registration-submit') });
    // Same document, same URL: the two capture paths must not disagree about the contract.
    expect(deriveActionContract({ verb: 'fill', node: pick(cdpNodes, '#company-name') })).toEqual(recordedFill);
    expect(deriveActionContract({ verb: 'click', node: pick(cdpNodes, '#registration-submit') })).toEqual(recordedSubmit);
    expect(recordedSubmit.affordance.form_method).toBe('get');
    expect(recordedFill.affordance.enter_behavior).toBe('submits_form');

    const caller = new BrowserToolCaller(page);
    const fillArgs = { selector: '#company-name', stableId: stableNodeRef(pick(staticNodes, '#company-name').id), role: 'textbox', name: 'Company name', value: 'Acme Tools', contract: recordedFill };
    const clickArgs = { selector: '#registration-submit', stableId: stableNodeRef(pick(staticNodes, '#registration-submit').id), role: 'button', name: 'Submit registration', contract: recordedSubmit };

    // Frozen form: both gated steps dispatch.
    expect(await caller.call('browser.fill', fillArgs)).toMatchObject({ ok: true, result: { action_contract: { compatible: true } } });
    expect(await page.evaluate<string>(`document.querySelector('#company-name').value`)).toBe('Acme Tools');

    // Textarea variant: identity resolves, contract stops the fill; the field stays untouched.
    await page.navigate(server.url('drift/b2-contract-textarea.html'));
    expect(await caller.call('browser.fill', fillArgs)).toMatchObject({ ok: false, error: { code: 'BROWSER_CONTRACT_MISMATCH' } });
    expect(await page.evaluate<string>(`document.querySelector('#company-name').value`)).toBe('');

    // Destructive variant: same-named submit became a POST purge; zero clicks (form still present, no navigation).
    await page.navigate(server.url('drift/b2-contract-destructive.html'));
    const before = await page.evaluate<string>('location.href');
    const refused = await caller.call('browser.click', clickArgs);
    expect(refused).toMatchObject({ ok: false, error: { code: 'BROWSER_CONTRACT_MISMATCH' } });
    if (refused.ok) throw new Error('unreachable');
    expect(refused.error.message).toContain('navigation → mutating');
    expect(await page.evaluate<string>('location.href')).toBe(before);
    expect(await page.evaluate<boolean>(`document.querySelector('#registration-form') !== null`)).toBe(true);

    // B6 (docs/03 false-match test): the offboarding page looks like B2 — same title,
    // same eight fields, same ids and names — but the same-named submit posts to
    // /vendors/offboard. A forced B2 replay fills (identity resolves) and then the
    // gate refuses the submit: no POST, no navigation, form still present.
    await page.navigate(server.url('b6-vendor-offboarding.html'));
    expect(await caller.call('browser.fill', fillArgs)).toMatchObject({ ok: true });
    const b6Before = await page.evaluate<string>('location.href');
    const b6 = await caller.call('browser.click', clickArgs);
    expect(b6).toMatchObject({ ok: false, error: { code: 'BROWSER_CONTRACT_MISMATCH' } });
    if (b6.ok) throw new Error('unreachable');
    expect(b6.error.message).toContain('destination');
    expect(b6.error.message).toContain('navigation → mutating');
    expect(await page.evaluate<string>('location.href')).toBe(b6Before);
    expect(await page.evaluate<boolean>(`document.querySelector('#registration-form') !== null`)).toBe(true);
    expect(await page.evaluate<boolean>(`document.querySelector('#registration-confirmation').hidden`)).toBe(true);
  }, 60_000);
});
