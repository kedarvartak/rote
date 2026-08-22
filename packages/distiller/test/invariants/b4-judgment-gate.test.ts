import { describe, expect, it } from 'vitest';
import { distillTrajectory, UnparameterizedValueError, type DistillableEvent } from '../../src/index.js';

// see docs/03-benchmark.md B4 — "includes a judgment gate". The category the
// agent routes an item to is decided per item from its content. A playbook that
// froze one run's category would replay it against every future item: silently
// wrong at volume (invariant 1). The gate is the distiller's fail-closed
// parameterization: a dispatched value that matches no declared param aborts
// distillation, so the judgment-dependent playbook can never be created.

const selectContract = {
  version: 1 as const,
  verb: 'select' as const,
  target: { role: 'combobox', name: 'Category', stable_id: 'v2:b4c47e0a91d2f356' },
  affordance: { control: 'select_single' as const, enter_behavior: 'none' as const, draggable: false },
  safety: 'local_input' as const,
  preconditions: { visible: true as const, enabled: true },
};
const routeContract = {
  ...selectContract,
  verb: 'click' as const,
  target: { role: 'button', name: 'Route item', stable_id: 'v2:5f13c98a20de6471' },
  affordance: { control: 'submit' as const, enter_behavior: 'none' as const, form_method: 'get' as const, draggable: false },
  safety: 'navigation' as const,
};

function event(seq: number, tool: string, args: Record<string, unknown>, result: unknown): DistillableEvent {
  return {
    event: {
      run_id: 'run-b4', seq, ts: '2026-08-22T00:00:00.000Z', tool, args,
      result_digest: { sha256: '0'.repeat(64), byte_length: 1, preview: '' }, result_ref: { kind: 'inline', value: result },
      duration_ms: 1,
    },
    result,
  };
}
const strong = (kind: string, target: string) => ({ action_kind: kind, strength: 'strong', classification: 'exact_effect_observed', passed: true, enforced: true, target });

// One successful triage of TKT-1041; 'billing' came from the planner's judgment
// over the item body, not from a declared param.
const trajectory: DistillableEvent[] = [
  event(0, 'browser.navigate', { kind: 'navigate', url: 'https://fixture.test/b4-triage.html?item=TKT-1041' }, { post_action_evidence: strong('navigate', 'https://fixture.test/b4-triage.html?item=TKT-1041') }),
  event(1, 'browser.select', { kind: 'select', selector: '#triage-category', role: 'combobox', name: 'Category', value: 'billing' }, { post_action_evidence: strong('select', '#triage-category'), resolution: { selector: '#triage-category', strategy: 'stable-id', stableId: 'v2:b4c47e0a91d2f356' }, action_contract: selectContract }),
  event(2, 'browser.click', { kind: 'click', selector: '#triage-route', role: 'button', name: 'Route item' }, { post_action_evidence: strong('click', '#triage-route'), resolution: { selector: '#triage-route', strategy: 'stable-id', stableId: 'v2:5f13c98a20de6471' }, action_contract: routeContract }),
  event(3, 'browser.done', { kind: 'done', success: true, summary: 'routed' }, {}),
];

const options = {
  playbookName: 'b4-triage',
  intentDescription: 'Triage support item {{item_id}}',
  envFingerprint: { domain: 'fixture.test', tool_prefixes: ['browser.'] },
  params: [
    { name: 'item_id', type: 'string' as const, value: 'TKT-1041' },
    { name: 'base_url', type: 'string' as const, value: 'https://fixture.test' },
  ],
  verify: [{ text_visible: 'Item routed' }],
};

describe('B4 judgment gate (sacred invariant: never silently wrong)', () => {
  it('refuses to distill a run whose routed category came from judgment, naming the step but never the category', () => {
    expect(() => distillTrajectory(trajectory, options)).toThrow(UnparameterizedValueError);
    let error: UnparameterizedValueError | undefined;
    try { distillTrajectory(trajectory, options); } catch (caught) { error = caught as UnparameterizedValueError; }
    expect(error?.stepId).toBe('select_category');
    expect(error?.message).not.toContain('billing');
  });

  it('shows exactly what the default forbids: an explicit literal opt-in freezes one item’s category for every future item', () => {
    const frozen = distillTrajectory(trajectory, { ...options, literalValues: 'allow' });
    const select = frozen.playbook.steps.find((step) => step.tool === 'browser.select');
    // TKT-1042 (a security compromise) would be routed to billing by this playbook.
    expect(select).toMatchObject({ args: { value: 'billing' } });
    expect(frozen.playbook.params.map((param) => param.name)).not.toContain('category');
  });

  it('distills cleanly when the category is a declared param — the caller owns the judgment per run', () => {
    const declared = distillTrajectory(trajectory, {
      ...options,
      params: [...options.params, { name: 'category', type: 'string' as const, value: 'billing' }],
    });
    const select = declared.playbook.steps.find((step) => step.tool === 'browser.select');
    expect(select).toMatchObject({ args: { value: '{{category}}' } });
    expect(declared.usedParams).toContain('category');
  });
});
