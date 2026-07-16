import { describe, expect, it } from 'vitest';
import type { CapturedPage } from '@rote/browser';
import { runBrowserAgent, type BrowserAction, type BrowserAgentVerifier, type BrowserPageSession, type BrowserPlannerClient } from '../src/index.js';

/**
 * The independent final gate, modelled on the real `--verify-text`: it is authored
 * against ground truth rather than guessed, which is why it — not the per-action
 * expect — is what makes a success real (docs/02 "Repair ladder").
 */
function groundTruthVerifier(): BrowserAgentVerifier {
  return {
    async verify(captured: CapturedPage) {
      const confirmed = captured.elements.some(
        (element) => element.text === 'Vendor registration complete' && !('hidden' in element.attributes),
      );
      return { success: confirmed, summary: confirmed ? 'vendor registration confirmed' : 'no confirmation on page' };
    },
  };
}

/**
 * Regression tests for the T1 B2 false negative (#49).
 *
 * The fixture models the shape that caused it: a confirmation section that is
 * `hidden` until the submit lands. Our distiller drops hidden nodes, so the
 * post-click state is not expressible from the pre-click observation in *any*
 * Expect DSL primitive — the model can neither name the confirmation text nor
 * its selector. A planner that guesses is guessing blind, by construction.
 */
function vendorFormPage(): BrowserPageSession & { submitted: () => boolean } {
  let submitted = false;
  return {
    submitted: () => submitted,
    async navigate() {},
    async fill() {},
    async select() {},
    async click(selector: string) {
      if (selector === '#registration-submit') submitted = true;
    },
    async capture(): Promise<CapturedPage> {
      // The confirmation exists in the DOM throughout but is hidden until submit,
      // exactly like fixtures/sites/b2-vendor-form.html.
      const confirmation = submitted
        ? [{ tag: 'h2', attributes: { id: 'registration-complete-heading' }, text: 'Vendor registration complete', depth: 1 }]
        : [{ tag: 'h2', attributes: { id: 'registration-complete-heading', hidden: '' }, text: 'Vendor registration complete', depth: 1 }];
      return {
        url: 'https://fixture.test/b2-vendor-form.html',
        title: 'Vendor Registration',
        html: '<form/>',
        elements: [
          { tag: 'button', attributes: { id: 'registration-submit' }, text: 'Submit registration', depth: 1 },
          ...confirmation,
        ],
      };
    },
  };
}

/** Replays a fixed script of planner actions, recording which usage sources were requested. */
function scriptedPlanner(script: readonly BrowserAction[]): BrowserPlannerClient & { sources: string[] } {
  const sources: string[] = [];
  let index = 0;
  return {
    sources,
    async plan(source) {
      sources.push(source);
      const action = script[Math.min(index, script.length - 1)];
      index += 1;
      return { action: action!, usage: { source, input_tokens: 10, output_tokens: 2 } };
    },
  };
}

describe('action expects: a wrong postcondition does not fail a correct run (#49)', () => {
  it('does not record failure when the task completed but the model guessed the confirmation text wrong', async () => {
    const page = vendorFormPage();
    // The exact expect a real gpt-5.6-sol run invented on T1. The page says
    // "Vendor registration complete"; this is a reasonable, wrong guess.
    const planner = scriptedPlanner([
      { kind: 'click', selector: '#registration-submit', expect: { text_visible: 'Registration submitted' } },
      { kind: 'done', success: true, summary: 'registered the vendor' },
    ]);

    const result = await runBrowserAgent({
      task: 'Register the vendor',
      page,
      planner,
      verifier: groundTruthVerifier(),
      clock: () => 100,
    });

    expect(page.submitted()).toBe(true);
    expect(result.success).toBe(true);
    expect(planner.sources).toContain('repair');
  });

  it('still fails when the actions did not complete the task', async () => {
    const page = vendorFormPage();
    // Clicks the wrong control, so the form is never submitted. The repair budget
    // buys one correction; a planner that does not correct must still fail.
    const planner = scriptedPlanner([
      { kind: 'click', selector: '#wrong-button', expect: { text_visible: 'Vendor registration complete' } },
    ]);

    await expect(runBrowserAgent({
      task: 'Register the vendor',
      page,
      planner,
      verifier: groundTruthVerifier(),
      clock: () => 100,
    })).rejects.toThrow(/not visible/);

    expect(page.submitted()).toBe(false);
  });
});
