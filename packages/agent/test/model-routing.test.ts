import { describe, expect, it } from 'vitest';
import { captureStaticHtml } from '@rote/browser';
import { BrowserPlannerOutputError, runBrowserAgent, type BrowserAction, type BrowserPageSession, type BrowserPlannerClient, type BrowserPlannerSource } from '../src/index.js';

// see docs/05-roadmap.md P2 item 12 — model routing: a confident shadow prediction
// lets the cheap routine planner take a step; the frontier planner takes every
// other step, every repair, and every escalation. A routine planner can cost a
// call, never a wrong action: pre-dispatch failures re-plan on the frontier.

const HTML = `<!doctype html><html><head><title>V</title></head><body>
<form id="registration-form"><label for="company-name">Company name</label><input id="company-name" name="company_name" />
<button id="registration-submit" type="submit">Submit registration</button></form></body></html>`;
function page(): BrowserPageSession {
  return { async navigate() {}, async capture() { return captureStaticHtml('https://fixture.test/vendors/register', HTML); }, async fill() {}, async select() {}, async click() {} };
}
const CLICK: BrowserAction = { kind: 'click', selector: '#registration-submit', role: 'button', name: 'Submit registration' };
const DONE: BrowserAction = { kind: 'done', success: true, summary: 'ok' };

/** Planner double that records which sources it was asked for and answers from a script. */
function planner(label: string, script: BrowserAction[] | ((source: BrowserPlannerSource, step: number) => BrowserAction)) {
  const calls: Array<{ source: BrowserPlannerSource; step: number }> = [];
  let index = 0;
  const client: BrowserPlannerClient = {
    async plan(source, request) {
      calls.push({ source, step: request.step });
      const action = typeof script === 'function' ? script(source, request.step) : script[Math.min(index, script.length - 1)]!;
      index += 1;
      return { action, usage: { source, input_tokens: label === 'routine' ? 1 : 100, output_tokens: 1 } };
    },
  };
  return { client, calls };
}
const confident = (predicted: { kind: string; target: string } | undefined, confidence: number) => ({ predict: () => ({ predicted, confidence, source: 'trace' as const, matchedLength: 3, candidates: [] }) });

describe('model routing', () => {
  it('routes a confident step to the routine planner and everything else to the frontier, and reports the split', async () => {
    const routine = planner('routine', [CLICK, DONE]);
    const frontier = planner('frontier', [DONE]);
    let step = 0;
    const predictor = { predict: () => { step += 1; return step === 1 ? confident({ kind: 'click', target: '#registration-submit' }, 0.95).predict() : confident(undefined, 0).predict(); } };
    const result = await runBrowserAgent({ task: 't', page: page(), planner: frontier.client, verifier: { async verify() { return { success: true, summary: 'ok' }; } }, maxSteps: 4, predictor, routing: { routine: routine.client } });
    expect(result.success).toBe(true);
    expect(routine.calls).toEqual([{ source: 'planner', step: 0 }]);
    expect(frontier.calls).toEqual([{ source: 'planner', step: 1 }]);
    expect(result.steps.map((entry) => entry.route)).toEqual([{ planner: 'routine', reason: 'prediction_confident' }, { planner: 'frontier', reason: 'no_confident_prediction' }]);
    expect(result.routingSummary).toEqual({ routine: 1, frontier: 1, escalations: 0 });
    // Accounting reflects who was called: 1 routine input token + 100 frontier.
    expect(result.tokenUsage.map((usage) => usage.input_tokens)).toEqual([1, 100]);
    // Below the threshold nothing routes.
    const strict = await runBrowserAgent({ task: 't', page: page(), planner: planner('frontier', [DONE]).client, verifier: { async verify() { return { success: true, summary: 'ok' }; } }, maxSteps: 2, predictor: confident({ kind: 'done', target: '' }, 0.8), routing: { routine: planner('routine', [DONE]).client, minConfidence: 0.9 } });
    expect(strict.routingSummary).toEqual({ routine: 0, frontier: 1, escalations: 0 });
    // Without routing configured no route is recorded and the frontier plans everything.
    const none = await runBrowserAgent({ task: 't', page: page(), planner: planner('frontier', [DONE]).client, verifier: { async verify() { return { success: true, summary: 'ok' }; } }, maxSteps: 2, predictor: confident({ kind: 'done', target: '' }, 1) });
    expect(none.routingSummary).toBeUndefined();
    expect(none.steps[0]!.route).toBeUndefined();
  });

  it('escalates a routine step to the frontier when its output fails closed or its target cannot be resolved — the routine model never lands a wrong action', async () => {
    // Malformed routine output: its spend is kept, the frontier re-plans the same step.
    const badRoutine: BrowserPlannerClient = { async plan(source) { throw new BrowserPlannerOutputError('not json', '???', [{ source, input_tokens: 7, output_tokens: 3 }]); } };
    const frontier = planner('frontier', [CLICK, DONE]);
    const result = await runBrowserAgent({ task: 't', page: page(), planner: frontier.client, verifier: { async verify() { return { success: true, summary: 'ok' }; } }, maxSteps: 4, predictor: confident({ kind: 'click', target: '#registration-submit' }, 0.99), routing: { routine: badRoutine } });
    expect(result.steps[0]!.route).toEqual({ planner: 'routine', reason: 'prediction_confident', escalated: 'planner_output' });
    expect(result.steps[0]!.escalationUsage).toEqual([{ source: 'planner', input_tokens: 7, output_tokens: 3 }]);
    // Every step: the routine call is spent (7) and the frontier answers (100); the escalated spend is never hidden.
    expect(result.tokenUsage.map((usage) => usage.input_tokens)).toEqual([100, 7, 100, 7]);
    expect(result.routingSummary).toEqual({ routine: 2, frontier: 0, escalations: 2 });

    // Unresolvable routine target: the pre-dispatch repair is planned by the frontier, not the routine model.
    const wrongTarget = planner('routine', [{ kind: 'click', selector: '#does-not-exist', role: 'button', name: 'Nope' }]);
    const repairing = planner('frontier', (source) => (source === 'repair' ? CLICK : DONE));
    let asked = 0;
    const firstStepOnly = { predict: () => { asked += 1; return confident(asked === 1 ? { kind: 'click', target: '#registration-submit' } : undefined, asked === 1 ? 0.99 : 0).predict(); } };
    const repaired = await runBrowserAgent({ task: 't', page: page(), planner: repairing.client, verifier: { async verify() { return { success: true, summary: 'ok' }; } }, maxSteps: 4, predictor: firstStepOnly, routing: { routine: wrongTarget.client } });
    expect(repaired.success).toBe(true);
    expect(wrongTarget.calls.map((call) => call.source)).toEqual(['planner']);
    expect(repairing.calls).toEqual([{ source: 'repair', step: 0 }, { source: 'planner', step: 1 }]);
    expect(repaired.steps[0]!.route).toEqual({ planner: 'routine', reason: 'prediction_confident', escalated: 'target_repair' });
    expect(repaired.steps[0]!.action).toEqual(CLICK);
  });
});
