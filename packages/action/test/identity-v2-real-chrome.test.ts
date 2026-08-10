import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { findChromeExecutable, FixtureSiteServer, LaunchingCdpBrowserBackend, type CapturedPage, type CdpPage } from '@rote/browser';
import { distillPage, stableNodeRef } from '@rote/perception';
import { ElementResolutionAmbiguityError, resolveElementTarget } from '../src/index.js';

let server: FixtureSiteServer | undefined;
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

describe('identity v2 real-Chrome contract', () => {
  for (const repetition of [1, 2]) {
    it(`survives repeated-grid reorder/remount and rejects residual ambiguity (repetition ${repetition})`, async () => {
      if (process.env['ROTE_RUN_CDP_TESTS'] !== '1') return;
      const chromePath = findChromeExecutable();
      if (!chromePath) throw new Error('ROTE_RUN_CDP_TESTS=1 requires Chrome or Chromium');
      server = new FixtureSiteServer({ rootDir: resolve('../../fixtures/enterprise') });
      await server.start();
      backend = new LaunchingCdpBrowserBackend({ chromePath, windowSize: { width: 1440, height: 900 } });
      page = await backend.openPage();
      await page.navigate(server.url('repeated-grid.html'));

      const before = identitiesByFixtureKey(await page.capture());
      const rowHashes = ['invoice-1041', 'invoice-1042', 'invoice-1043'].map((key) => before.get(key)!.hash);
      expect(new Set(rowHashes).size).toBe(3);
      expect(before.get('ambiguous-a')).toEqual(before.get('ambiguous-b'));

      await page.evaluate(`document.querySelector('tbody').append(document.querySelector('tbody tr'))`);
      const reordered = identitiesByFixtureKey(await page.capture());
      for (const key of ['invoice-1041', 'invoice-1042', 'invoice-1043']) {
        expect(reordered.get(key)).toEqual(before.get(key));
      }

      await page.click('[data-remount]');
      const remounted = identitiesByFixtureKey(await page.capture());
      expect(remounted.get('invoice-2002')?.hash).not.toBe(before.get('invoice-2001')?.hash);

      const nodes = distillPage(await page.capture());
      expect(() => resolveElementTarget(nodes, {
        selector: '[data-ambiguous="true"]',
        stableId: stableNodeRef(remounted.get('ambiguous-a')!),
        role: 'button',
        name: 'Approve invoice',
      })).toThrow(ElementResolutionAmbiguityError);
    }, 30_000);
  }
});

function identitiesByFixtureKey(capture: CapturedPage): Map<string, ReturnType<typeof distillPage>[number]['id']> {
  const nodesBySelector = new Map(distillPage(capture).map((node) => [node.selectorHint, node]));
  return new Map(capture.elements.flatMap((element) => {
    const key = element.attributes['data-fixture-target-key'];
    const selector = element.attributes['data-rote-selector'];
    const node = selector ? nodesBySelector.get(selector) : undefined;
    return key && node ? [[key, node.id] as const] : [];
  }));
}
