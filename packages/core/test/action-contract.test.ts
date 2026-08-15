import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ActionContractSchema, compareActionContracts, type ActionContract } from '../src/index.js';

const contractArbitrary: fc.Arbitrary<ActionContract> = fc.record({
  version: fc.constant(1 as const),
  verb: fc.constantFrom('navigate', 'fill', 'select', 'click', 'hover', 'press', 'upload', 'dragAndDrop'),
  target: fc.record({
    role: fc.constantFrom('button', 'link', 'textbox', 'combobox', 'checkbox'),
    name: fc.string({ maxLength: 12 }),
    stable_id: fc.option(fc.hexaString({ minLength: 16, maxLength: 16 }).map((hex) => `v2:${hex}`), { nil: undefined }),
    context_hash: fc.option(fc.hexaString({ minLength: 16, maxLength: 16 }), { nil: undefined }),
  }, { requiredKeys: ['role', 'name'] }),
  affordance: fc.record({
    control: fc.constantFrom('single_line_text', 'multi_line_text', 'select_single', 'select_multiple', 'checkbox', 'radio', 'button', 'submit', 'link', 'file', 'generic'),
    input_type: fc.option(fc.constantFrom('text', 'email', 'number', 'password'), { nil: undefined }),
    enter_behavior: fc.constantFrom('submits_form', 'inserts_newline', 'none'),
    destination_hash: fc.option(fc.hexaString({ minLength: 16, maxLength: 16 }), { nil: undefined }),
    form_method: fc.option(fc.constantFrom('get', 'post', 'dialog'), { nil: undefined }),
    draggable: fc.boolean(),
  }, { requiredKeys: ['control', 'enter_behavior', 'draggable'] }),
  safety: fc.constantFrom('read', 'local_input', 'navigation', 'potentially_mutating', 'mutating'),
  preconditions: fc.record({ visible: fc.constant(true as const), enabled: fc.boolean() }),
  required_effect: fc.option(fc.record({
    evidence_class: fc.constantFrom('api_state', 'database_state', 'fixture_oracle', 'browser_download_event', 'ui_text', 'ui_url'),
    kind: fc.option(fc.constantFrom('grid_activated', 'spa_transition'), { nil: undefined }),
  }, { requiredKeys: ['evidence_class'] }), { nil: undefined }),
}, { requiredKeys: ['version', 'verb', 'target', 'affordance', 'safety', 'preconditions'] }).map((value) => ActionContractSchema.parse(JSON.parse(JSON.stringify(value))));

describe('action contract schema and comparison', () => {
  it('is strict: captured values and unknown fields never parse', () => {
    const base = fc.sample(contractArbitrary, 1)[0]!;
    expect(() => ActionContractSchema.parse({ ...base, value: 'secret' })).toThrow();
    expect(() => ActionContractSchema.parse({ ...base, affordance: { ...base.affordance, href: 'https://x' } })).toThrow();
    expect(() => ActionContractSchema.parse({ ...base, version: 2 })).toThrow();
  });

  it('is reflexive and symmetric in compatibility', () => {
    fc.assert(fc.property(contractArbitrary, contractArbitrary, (left, right) => {
      expect(compareActionContracts(left, left)).toEqual({ compatible: true, drift: [] });
      expect(compareActionContracts(left, right).compatible).toBe(compareActionContracts(right, left).compatible);
    }));
  });

  it('treats identity-only differences as drift and everything behavioral as mismatch', () => {
    fc.assert(fc.property(contractArbitrary, fc.string({ maxLength: 12 }), (contract, name) => {
      const renamed = { ...contract, target: { ...contract.target, name } };
      const comparison = compareActionContracts(contract, renamed);
      expect(comparison.compatible).toBe(true);
      if (comparison.compatible) expect(comparison.drift).toEqual(name === contract.target.name ? [] : ['name']);
    }));
    fc.assert(fc.property(contractArbitrary, (contract) => {
      const flipped = { ...contract, preconditions: { visible: true as const, enabled: !contract.preconditions.enabled } };
      expect(compareActionContracts(contract, flipped)).toMatchObject({ compatible: false, classification: 'contract_mismatch', mismatches: [{ field: 'precondition' }] });
    }));
  });
});
