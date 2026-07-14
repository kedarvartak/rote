import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureStaticHtml } from '@rote/browser';
import { distillPage } from '@rote/perception';
import {
  ElementResolutionError,
  evaluateBrowserExpect,
  resolveElementTarget,
  waitForSettled,
  type BrowserActivitySample,
} from '../src/index.js';

const baseline = distillPage(fixture('../b2-vendor-form.html'));
const baselineSubmit = baseline.find((node) => node.selectorHint === '#registration-submit')!;
const target = {
  selector: '#registration-submit',
  stableId: baselineSubmit.id.hash,
  role: baselineSubmit.role,
  name: baselineSubmit.name,
  text: baselineSubmit.name,
};

describe('B2 DOM drift safety suite', () => {
  it.each([
    ['b2-selector-renamed.html', '#registration-submit-v2'],
    ['b2-wrapper-inserted.html', '#registration-submit-v3'],
  ])('recovers the intended submit control from %s', (name, expectedSelector) => {
    const result = resolveElementTarget(distillPage(fixture(name)), target);

    expect(result.selector).toBe(expectedSelector);
    expect(['stable-id', 'role-name', 'text-proximity']).toContain(result.strategy);
  });

  it('does not follow a stale selector that now points at a destructive decoy', () => {
    const result = resolveElementTarget(distillPage(fixture('b2-stale-selector-decoy.html')), target);

    expect(result.selector).toBe('#registration-submit-v2');
    expect(result.selector).not.toBe('#registration-submit');
  });

  it('fails closed when duplicate semantic controls are ambiguous', () => {
    expect(() => resolveElementTarget(distillPage(fixture('b2-ambiguous.html')), target)).toThrow(
      ElementResolutionError,
    );
  });

  it('does not treat a hidden replacement as visible', () => {
    const page = fixture('b2-hidden-control.html');

    expect(evaluateBrowserExpect({ selector_visible: '#registration-submit' }, page)).toEqual({
      pass: false,
      reason: 'selector "#registration-submit" not visible',
    });
  });
});

describe('delayed SPA state safety', () => {
  it('beats a naive fixed wait across varied deterministic delays', async () => {
    const delays = [25, 75, 100, 150, 200];
    const naiveSuccesses = delays.filter((delay) => delay <= 50).length;
    let settledSuccesses = 0;

    for (const delay of delays) {
      let now = 0;
      const settled = await waitForSettled({
        async sampleActivity(): Promise<BrowserActivitySample> {
          return now < delay
            ? { pendingRequests: 1, mutationVersion: 0 }
            : { pendingRequests: 0, mutationVersion: 1 };
        },
      }, {
        quietWindowMs: 50,
        pollIntervalMs: 25,
        timeoutMs: 500,
        clock: () => now,
        sleep: async (ms) => { now += ms; },
      });
      if (settled.pendingRequests === 0 && settled.mutationVersion === 1) settledSuccesses += 1;
    }

    expect(naiveSuccesses).toBe(1);
    expect(settledSuccesses).toBe(5);
  });
});

function fixture(name: string) {
  const path = resolve('../../fixtures/sites/drift', name);
  return captureStaticHtml(path, readFileSync(path, 'utf8'));
}
