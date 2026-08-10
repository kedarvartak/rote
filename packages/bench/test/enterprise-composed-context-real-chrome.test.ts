import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ElementResolutionAmbiguityError, ElementResolutionContextMismatchError, resolveElementTarget } from '@rote/action';
import { ClosedShadowRootUnsupportedError, findChromeExecutable, LaunchingCdpBrowserBackend, type CdpPage } from '@rote/browser';
import { sha256Hex } from '@rote/core';
import { BrowserToolCaller } from '@rote/executor';
import { applyObservationDiff, diffObservations, distillPage, stableNodeRef, type DistilledNode } from '@rote/perception';
import { EnterpriseFixtureServer } from '../src/index.js';

let server: EnterpriseFixtureServer | undefined;
let backend: LaunchingCdpBrowserBackend | undefined;
let page: CdpPage | undefined;

afterEach(async () => {
  page?.close();
  page = undefined;
  await backend?.close();
  backend = undefined;
  await server?.close();
  server = undefined;
});

describe('enterprise composed browser contexts in real Chrome', () => {
  for (const repetition of [1, 2]) {
    it(`captures, resolves, and dispatches nested same/cross frames and open shadows (repetition ${repetition})`, async () => {
      if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
      ({ server, backend, page } = await openFixture('frame-host.html'));
      server.reset();
      const capture = await page.capture();
      const approvals = distillPage(capture).filter((node) => node.role === 'button' && node.name === 'Approve invoice');
      const primaryOriginHash = sha256Hex(new URL(server.url('/')).origin).slice(0, 16);
      const crossOriginHash = sha256Hex(new URL(server.crossOriginUrl('/')).origin).slice(0, 16);
      const same = approvals.find((node) => frameOriginHashes(node).includes(primaryOriginHash))!;
      const cross = approvals.find((node) => frameOriginHashes(node).includes(crossOriginHash))!;

      expect(same.context?.path).toHaveLength(2);
      expect(cross.context?.path).toHaveLength(2);
      expect(same.id.hash).not.toBe(cross.id.hash);
      const caller = new BrowserToolCaller(page);
      expect(await caller.call('browser.click', target(same))).toEqual(expect.objectContaining({ ok: true }));
      expect(await caller.call('browser.click', target(cross))).toEqual(expect.objectContaining({ ok: true }));
      const afterFrameActions = distillPage(await page.capture());
      expect(applyObservationDiff(distillPage(capture), diffObservations(distillPage(capture), afterFrameActions))).toEqual(afterFrameActions);
      await waitFor(() => server!.snapshot('frame-contract').events.length === 2);
      expect(server.snapshot('frame-contract').events.map((event) => event.event_id).sort()).toEqual(['frame-cross', 'frame-same']);

      page.close();
      page = undefined;
      await backend.close();
      backend = undefined;
      ({ backend, page } = await openBrowser(server.url('shadow-controls.html')));
      server.reset();
      const shadowCapture = await page.capture();
      const shadow = distillPage(shadowCapture).find((node) => node.name === 'Approve invoice' && node.context?.path.filter((segment) => segment.kind === 'shadow').length === 2)!;
      expect(shadow.context?.path).toHaveLength(2);
      expect(await new BrowserToolCaller(page).call('browser.click', target(shadow))).toEqual(expect.objectContaining({ ok: true }));
      await waitFor(() => server!.snapshot('shadow-contract').events.length === 1);
      expect(server.snapshot('shadow-contract').events[0]).toEqual(expect.objectContaining({ event_id: 'shadow-open', target_key: 'open-shadow-approval' }));
      expect(server.snapshot('shadow-contract').events.some((event) => event.event_id === 'shadow-closed-decoy')).toBe(false);
    }, 30_000);
  }

  it('rejects context splicing, stale frame documents, duplicate inner controls, and closed roots before dispatch', async () => {
    if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
    ({ server, backend, page } = await openFixture('frame-host.html'));
    server.reset();
    let capture = await page.capture();
    let approvals = distillPage(capture).filter((node) => node.role === 'button' && node.name === 'Approve invoice');
    const [first, second] = approvals;
    expect(first?.context?.contextHash).not.toBe(second?.context?.contextHash);
    const spliced = { ...target(first!), contextHash: second!.context!.contextHash };
    expect(() => resolveElementTarget(approvals, spliced)).toThrow(ElementResolutionContextMismatchError);
    expect(await new BrowserToolCaller(page).call('browser.click', spliced)).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'BROWSER_CONTEXT_MISMATCH' }),
    });

    const stalePage = page;
    const staleCaller = new BrowserToolCaller({
      navigate: (url) => stalePage.navigate(url),
      capture: () => stalePage.capture(),
      fill: (selector, value, context) => stalePage.fill(selector, value, context),
      select: (selector, value, context) => stalePage.select(selector, value, context),
      click: async (selector, context) => {
        await stalePage.evaluate(`document.querySelector('[data-remount-same-frame]').click()`);
        await waitFor(async () => (await stalePage.evaluate(`document.querySelector('[data-context-key="same-workspace"]').dataset.contextEpoch`)) === '2');
        await stalePage.click(selector, context);
      },
    });
    const staleOutcome = await staleCaller.call('browser.click', target(first!));
    expect(staleOutcome).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'BROWSER_CONTEXT_STALE' }),
    });
    expect(server.snapshot('frame-contract').events).toHaveLength(0);

    await page.evaluate(`(() => {
      const frame = document.querySelector('[data-context-key="same-workspace"]');
      frame.src = './frame-level-one.html?scope=same&duplicate=true';
    })()`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    capture = await page.capture();
    approvals = distillPage(capture).filter((node) => node.role === 'button' && node.name === 'Approve invoice');
    const duplicateContext = approvals.find((node, index) => approvals.some((other, otherIndex) => otherIndex !== index && other.context?.contextHash === node.context?.contextHash))!.context!;
    expect(() => resolveElementTarget(approvals, {
      selector: 'button', role: 'button', name: 'Approve invoice', contextHash: duplicateContext.contextHash,
    })).toThrow(ElementResolutionAmbiguityError);
    expect(server.snapshot('frame-contract').events).toHaveLength(0);

    page.close();
    page = undefined;
    await backend.close();
    backend = undefined;
    ({ backend, page } = await openBrowser(server.url('shadow-controls.html')));
    const shadowCapture = await page.capture();
    const closed = shadowCapture.unsupportedContexts?.find((context) => context.classification === 'closed_shadow_root_unsupported');
    expect(closed).toBeDefined();
    if (!closed) throw new Error('closed shadow context was not classified');
    await expect(page.click('button', closed.coordinate)).rejects.toBeInstanceOf(ClosedShadowRootUnsupportedError);
    const closedOutcome = await new BrowserToolCaller(page).call('browser.click', {
      selector: 'button', contextHash: closed.coordinate.contextHash,
    });
    expect(closedOutcome).toEqual({
      ok: false,
      error: expect.objectContaining({ code: 'CLOSED_SHADOW_ROOT_UNSUPPORTED' }),
    });
    expect(server.snapshot('shadow-contract').events).toHaveLength(0);
  }, 30_000);
});

function target(node: DistilledNode): Record<string, unknown> {
  return {
    selector: node.selectorHint!,
    stableId: stableNodeRef(node.id),
    contextHash: node.context!.contextHash,
    role: node.role,
    name: node.name,
  };
}

function frameOriginHashes(node: DistilledNode): string[] {
  return node.context?.path.flatMap((segment) => segment.kind === 'frame' ? [segment.originHash] : []) ?? [];
}

async function openFixture(path: string) {
  const fixtureServer = new EnterpriseFixtureServer(resolve('../../fixtures/enterprise'));
  await fixtureServer.start();
  const browser = await openBrowser(fixtureServer.url(path));
  return { server: fixtureServer, ...browser };
}

async function openBrowser(url: string) {
  const chromePath = findChromeExecutable();
  if (!chromePath) throw new Error('enterprise context Chrome contract requires Chrome or Chromium');
  const browserBackend = new LaunchingCdpBrowserBackend({ chromePath, windowSize: { width: 1440, height: 900 } });
  const browserPage = await browserBackend.openPage();
  await browserPage.navigate(url);
  return { backend: browserBackend, page: browserPage };
}

async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
  throw new Error(`condition not met within ${timeoutMs}ms`);
}
