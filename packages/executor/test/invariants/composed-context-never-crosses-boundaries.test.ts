import { describe, expect, it } from 'vitest';
import { browserContextCoordinate, BrowsingContextStaleError, type BrowserContextCoordinate, type CapturedPage } from '@rote/browser';
import { distillPage, stableNodeRef } from '@rote/perception';
import { BrowserToolCaller, type BrowserReplayPage } from '../../src/index.js';

const token = 'aaaaaaaaaaaaaaaa';
const same = browserContextCoordinate([
  { kind: 'frame', keyHash: '1111111111111111', originHash: '2222222222222222' },
], token);
const cross = browserContextCoordinate([
  { kind: 'frame', keyHash: '3333333333333333', originHash: '4444444444444444' },
], token);
const closed = browserContextCoordinate([
  { kind: 'shadow', keyHash: '5555555555555555', mode: 'closed' },
], token);

class ContextPage implements BrowserReplayPage {
  mutations: string[] = [];
  stale = false;

  async navigate(): Promise<void> {}
  async fill(): Promise<void> {}
  async select(): Promise<void> {}
  async click(selector: string, context?: BrowserContextCoordinate): Promise<void> {
    if (this.stale) throw new BrowsingContextStaleError(context?.contextHash ?? 'unknown');
    this.mutations.push(`${context?.contextHash}:${selector}`);
  }
  async capture(): Promise<CapturedPage> {
    return {
      url: 'https://fixture.test/contexts',
      title: 'Contexts',
      html: '',
      elements: [button('#same', same), button('#cross', cross)],
      unsupportedContexts: [{ coordinate: closed, classification: 'closed_shadow_root_unsupported' }],
    };
  }
}

describe('composed context boundaries never silently dispatch', () => {
  it('rejects a stable target spliced onto another frame before dispatch', async () => {
    const page = new ContextPage();
    const node = distillPage(await page.capture()).find((candidate) => candidate.selectorHint === '#same')!;
    const result = await new BrowserToolCaller(page).call('browser.click', {
      selector: '#same', stableId: stableNodeRef(node.id), contextHash: cross.contextHash,
      role: 'button', name: 'Approve invoice',
    });

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'BROWSER_CONTEXT_MISMATCH' }) });
    expect(page.mutations).toEqual([]);
  });

  it('classifies closed roots without dispatching their destructive decoy', async () => {
    const page = new ContextPage();
    const result = await new BrowserToolCaller(page).call('browser.click', {
      selector: 'button', contextHash: closed.contextHash,
    });

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'CLOSED_SHADOW_ROOT_UNSUPPORTED' }) });
    expect(page.mutations).toEqual([]);
  });

  it('reports a stale document token without applying the action', async () => {
    const page = new ContextPage();
    page.stale = true;
    const node = distillPage(await page.capture()).find((candidate) => candidate.selectorHint === '#same')!;
    const result = await new BrowserToolCaller(page).call('browser.click', {
      selector: '#same', stableId: stableNodeRef(node.id), contextHash: same.contextHash,
      role: 'button', name: 'Approve invoice',
    });

    expect(result).toEqual({ ok: false, error: expect.objectContaining({ code: 'BROWSER_CONTEXT_STALE' }) });
    expect(page.mutations).toEqual([]);
  });
});

function button(selector: string, context: BrowserContextCoordinate) {
  return {
    tag: 'button',
    attributes: { 'aria-label': 'Approve invoice', 'data-rote-selector': selector },
    text: 'Approve',
    depth: 2,
    context,
  };
}
