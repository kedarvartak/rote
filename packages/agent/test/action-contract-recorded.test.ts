import { describe, expect, it } from 'vitest';
import { captureStaticHtml } from '@rote/browser';
import { pageKey } from '@rote/core';
import { runBrowserAgent, type BrowserAction, type BrowserPageSession, type BrowserPlannerClient } from '../src/index.js';

// see docs/02 "Structural action-contract drift" (#143) — the live loop records
// the value-free contract of every resolved target so the distiller can persist
// it; replay later compares it before dispatch.

const HTML = `<!doctype html><html><head><title>Vendor Registration</title></head><body>
<form id="registration-form" method="post" action="/vendors/register">
  <label for="company-name">Company name</label><input id="company-name" name="company_name" />
  <button id="registration-submit" type="submit">Submit registration</button>
</form></body></html>`;

function page(): BrowserPageSession {
  return {
    async navigate() {},
    async capture() { return captureStaticHtml('https://fixture.test/vendors/register', HTML); },
    async fill() {}, async select() {}, async click() {},
  };
}

function scripted(actions: BrowserAction[]): BrowserPlannerClient {
  let index = 0;
  return { async plan(source) { const action = actions[Math.min(index, actions.length - 1)]!; index += 1; return { action, usage: { source, input_tokens: 1, output_tokens: 1 } }; } };
}

describe('live loop records action contracts', () => {
  it('attaches a derived contract to every element step and none to navigate/done', async () => {
    const result = await runBrowserAgent({
      task: 'Register',
      page: page(),
      planner: scripted([
        { kind: 'navigate', url: 'https://fixture.test/vendors/register' },
        { kind: 'fill', selector: '#company-name', role: 'textbox', name: 'Company name', value: 'Acme Tools' },
        { kind: 'click', selector: '#registration-submit', role: 'button', name: 'Submit registration' },
        { kind: 'done', success: true, summary: 'submitted' },
      ]),
      verifier: { async verify() { return { success: true, summary: 'ok', checks: [{ text_visible: 'Vendor registration complete' }], consumedEvidence: [{ evidence_class: 'fixture_oracle' }, { evidence_class: 'fixture_oracle' }] } as never; } },
      maxSteps: 6,
    });
    const [navigate, fill, click, done] = result.steps;
    // The terminal step records what decided success — checks + evidence classes —
    // and only the terminal step does (the distiller learns `verify` from it).
    expect(done!.verification).toEqual({ success: true, summary: 'ok', checks: [{ text_visible: 'Vendor registration complete' }], evidenceClasses: ['fixture_oracle'] });
    expect([navigate, fill, click].every((step) => step!.verification === undefined)).toBe(true);
    expect(navigate!.actionContract).toBeUndefined();
    expect(fill!.actionContract).toEqual({
      version: 1,
      verb: 'fill',
      target: { role: 'textbox', name: 'Company name', stable_id: expect.stringMatching(/^v2:[0-9a-f]{16}$/) },
      affordance: { control: 'single_line_text', input_type: 'text', enter_behavior: 'submits_form', draggable: false },
      safety: 'local_input',
      preconditions: { visible: true, enabled: true },
    });
    expect(click!.actionContract).toMatchObject({
      verb: 'click',
      affordance: { control: 'submit', form_method: 'post', destination_hash: expect.stringMatching(/^[0-9a-f]{16}$/) },
      safety: 'mutating',
    });
    // The recorded contract never carries the typed value.
    expect(JSON.stringify(fill!.actionContract)).not.toContain('Acme');
    expect(done!.actionContract).toBeUndefined();
    // Page identity travels as digests only (site memory keys on them).
    const key = pageKey('https://fixture.test/vendors/register');
    expect(fill!.pageKey).toBe(key);
    expect(fill!.nextPageKey).toBe(key);
  });
});
