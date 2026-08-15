import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parsePlaybookYaml, writePlaybookYaml } from '@rote/core';
import { distillTrajectory, EmptyTrajectoryError, UnparameterizedValueError, type DistillableEvent } from '../src/index.js';

const contract = {
  version: 1 as const,
  verb: 'fill' as const,
  target: { role: 'textbox', name: 'Company name', stable_id: 'v2:d74d412bb4457dcb' },
  affordance: { control: 'single_line_text' as const, input_type: 'text', enter_behavior: 'submits_form' as const, draggable: false },
  safety: 'local_input' as const,
  preconditions: { visible: true as const, enabled: true },
};

function event(seq: number, tool: string, args: Record<string, unknown>, result: unknown, error?: string): DistillableEvent {
  return {
    event: {
      run_id: 'run-1', seq, ts: '2026-08-15T00:00:00.000Z', tool, args,
      result_digest: { sha256: '0'.repeat(64), byte_length: 1, preview: '' }, result_ref: { kind: 'inline', value: result },
      duration_ms: 1, ...(error ? { error: { message: error } } : {}),
    },
    result,
  };
}

const strong = (kind: string, target: string) => ({ action_kind: kind, strength: 'strong', classification: 'exact_effect_observed', passed: true, enforced: true, target });
const reaction = { action_kind: 'click', strength: 'reaction', classification: 'click_reaction_observed', passed: true, enforced: false, target: '#registration-submit' };

const options = {
  playbookName: 'b2-distilled',
  intentDescription: 'Register a vendor',
  envFingerprint: { domain: 'fixture.test', tool_prefixes: ['browser.'] },
  params: [{ name: 'company_name', type: 'string' as const, value: 'Acme Tools' }, { name: 'base_url', type: 'string' as const, value: 'https://fixture.test' }],
  verify: [{ text_visible: 'Vendor registration complete' }],
};

const trajectory: DistillableEvent[] = [
  event(0, 'browser.navigate', { kind: 'navigate', url: 'https://fixture.test/vendors/register' }, { post_action_evidence: strong('navigate', 'https://fixture.test/vendors/register') }),
  // Pre-dispatch failure: no evidence → pruned.
  event(1, 'browser.fill', { kind: 'fill', selector: '#missing', value: 'x' }, {}, 'could not resolve browser target'),
  // Superseded write: a first (typo) value corrected by seq 3.
  event(2, 'browser.fill', { kind: 'fill', selector: '#company-name', role: 'textbox', name: 'Company name', value: 'Acme Tool' }, { post_action_evidence: strong('fill', '#company-name'), resolution: { selector: '#company-name', strategy: 'stable-id', stableId: 'v2:d74d412bb4457dcb' }, action_contract: contract }),
  event(3, 'browser.fill', { kind: 'fill', selector: '#company-name', role: 'textbox', name: 'Company name', value: 'Acme Tools' }, { post_action_evidence: strong('fill', '#company-name'), resolution: { selector: '#company-name', strategy: 'stable-id', stableId: 'v2:d74d412bb4457dcb' }, action_contract: contract }),
  event(4, 'browser.click', { kind: 'click', selector: '#registration-submit-old', role: 'button', name: 'Submit registration' }, { post_action_evidence: reaction, resolution: { selector: '#registration-submit', strategy: 'role-name', stableId: 'v2:eb12e7244518c290' }, action_contract: { ...contract, verb: 'click', target: { role: 'button', name: 'Submit registration', stable_id: 'v2:eb12e7244518c290' }, affordance: { control: 'submit', enter_behavior: 'none', destination_hash: 'a58ac76f172d2339', form_method: 'get', draggable: false }, safety: 'navigation' } }),
  event(5, 'browser.done', { kind: 'done', success: true, summary: 'done' }, {}),
];

describe('distiller v1', () => {
  it('turns a trajectory into a contract-bearing, parameterized playbook and reports every pruned event', () => {
    const report = distillTrajectory(trajectory, options);
    expect(report.pruned).toEqual([
      { seq: 1, reason: 'not_dispatched' },
      { seq: 5, reason: 'terminal_done' },
      { seq: 2, reason: 'superseded_write' },
    ]);
    expect(report.kept.map((entry) => entry.stepId)).toEqual(['navigate_vendors_register', 'fill_company_name', 'click_submit_registration']);
    expect(report.contractedStepIds).toEqual(['fill_company_name', 'click_submit_registration']);
    expect(report.usedParams).toEqual(['base_url', 'company_name']);
    const [navigate, fill, click] = report.playbook.steps;
    expect(navigate).toMatchObject({ tool: 'browser.navigate', args: { url: '{{base_url}}/vendors/register' }, expect: { url_contains: '/vendors/register' }, depends_on: [] });
    expect(fill).toMatchObject({
      tool: 'browser.fill',
      args: { selector: '#company-name', stableId: 'v2:d74d412bb4457dcb', role: 'textbox', name: 'Company name', value: '{{company_name}}', contract },
      expect: { input_value: '#company-name', equals: '{{company_name}}' },
      depends_on: ['navigate_vendors_register'],
    });
    // The resolved selector wins over the planner's stale one; reaction evidence never becomes an expect.
    expect(click).toMatchObject({ tool: 'browser.click', args: { selector: '#registration-submit', stableId: 'v2:eb12e7244518c290' }, depends_on: ['fill_company_name'] });
    expect(click && 'expect' in click ? click.expect : undefined).toBeUndefined();
    expect(report.playbook.params).toEqual([{ name: 'company_name', type: 'string' }, { name: 'base_url', type: 'string' }]);
    expect(report.playbook.verify).toEqual(options.verify);
    // Round-trips through the YAML the executor loads.
    expect(parsePlaybookYaml(writePlaybookYaml(report.playbook))).toEqual(report.playbook);
  });

  it('refuses to persist a typed value that matches no declared param unless literals are allowed', () => {
    const undeclared = { ...options, params: [options.params[1]!] };
    expect(() => distillTrajectory(trajectory, undeclared)).toThrow(UnparameterizedValueError);
    let message = '';
    try { distillTrajectory(trajectory, undeclared); } catch (error) { message = (error as Error).message; }
    expect(message).toContain('fill_company_name');
    expect(message).not.toContain('Acme');
    const literal = distillTrajectory(trajectory, { ...undeclared, literalValues: 'allow' });
    expect(literal.playbook.steps[1]).toMatchObject({ args: { value: 'Acme Tools' } });
  });

  it('fails when nothing was dispatched', () => {
    expect(() => distillTrajectory([trajectory[1]!, trajectory[5]!], options)).toThrow(EmptyTrajectoryError);
  });

  it('never leaks any declared param value into the playbook (property)', () => {
    fc.assert(fc.property(
      fc.stringMatching(/^[A-Za-z0-9 @.-]{3,20}$/).filter((value) => value.trim() === value),
      fc.stringMatching(/^[A-Za-z0-9 @.-]{3,20}$/).filter((value) => value.trim() === value),
      (company, city) => {
        fc.pre(company !== city && !company.includes(city) && !city.includes(company));
        const events: DistillableEvent[] = [
          event(0, 'browser.fill', { kind: 'fill', selector: '#company-name', role: 'textbox', name: 'Company name', value: company }, { post_action_evidence: strong('fill', '#company-name'), resolution: { selector: '#company-name', strategy: 'selector' } }),
          event(1, 'browser.fill', { kind: 'fill', selector: '#city', role: 'textbox', name: 'City', value: `${city}` }, { post_action_evidence: strong('fill', '#city'), resolution: { selector: '#city', strategy: 'selector' } }),
        ];
        const report = distillTrajectory(events, { ...options, params: [{ name: 'company', type: 'string', value: company }, { name: 'city', type: 'string', value: city }] });
        const sent = report.playbook.steps.flatMap((step) => (step.kind === 'deterministic'
          ? [String(step.args['value']), step.expect && 'equals' in step.expect ? String(step.expect.equals) : '']
          : []));
        for (const leaf of sent) { expect(leaf).not.toContain(company); expect(leaf).not.toContain(city); }
        expect(sent[0]).toBe('{{company}}');
        expect(sent[2]).toBe('{{city}}');
      },
    ));
  });
});
