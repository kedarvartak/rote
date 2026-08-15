import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { captureStaticHtml } from '@rote/browser';
import { ActionContractSchema, compareActionContracts } from '@rote/core';
import { distillPage, stableNodeRef, type DistilledNode } from '@rote/perception';
import {
  ActionContractMismatchError,
  assertActionContract,
  deriveActionContract,
  resolveElementTarget,
} from '../src/index.js';

// see docs/02-architecture.md "Structural action-contract drift" (#143). The
// same fixed URL is used for every variant: drift is what the document says,
// not where the file happens to live.

const URL = 'https://fixture.test/vendors/register';

function nodes(name: string): DistilledNode[] {
  const path = name.startsWith('drift/') ? `../../fixtures/sites/${name}` : `../../fixtures/sites/${name}`;
  return distillPage(captureStaticHtml(URL, readFileSync(resolve(path), 'utf8')));
}

const baseline = nodes('b2-vendor-form.html');
const baselineCompany = baseline.find((node) => node.selectorHint === '#company-name')!;
const baselineSubmit = baseline.find((node) => node.selectorHint === '#registration-submit')!;

const recordedFill = deriveActionContract({ verb: 'fill', node: baselineCompany });
const recordedSubmit = deriveActionContract({ verb: 'click', node: baselineSubmit });

function liveContract(fixture: string, verb: 'fill' | 'click', recordedNode: DistilledNode) {
  const live = nodes(fixture);
  const resolution = resolveElementTarget(live, {
    selector: recordedNode.selectorHint!,
    stableId: stableNodeRef(recordedNode.id),
    role: recordedNode.role,
    name: recordedNode.name,
  });
  const node = live.find((candidate) => stableNodeRef(candidate.id) === resolution.stableId)!;
  return { resolution, contract: deriveActionContract({ verb, node }) };
}

describe('action contract derivation', () => {
  it('derives value-free, strict contracts from the frozen B2 form', () => {
    expect(ActionContractSchema.parse(recordedFill)).toEqual({
      version: 1,
      verb: 'fill',
      target: { role: 'textbox', name: 'Company name', stable_id: stableNodeRef(baselineCompany.id) },
      affordance: { control: 'single_line_text', input_type: 'text', enter_behavior: 'submits_form', draggable: false },
      safety: 'local_input',
      preconditions: { visible: true, enabled: true },
    });
    expect(recordedSubmit).toMatchObject({
      verb: 'click',
      target: { role: 'button', name: 'Submit registration' },
      affordance: { control: 'submit', enter_behavior: 'none', form_method: 'get' },
      safety: 'navigation',
    });
    expect(recordedSubmit.affordance.destination_hash).toMatch(/^[0-9a-f]{16}$/);
    // Strict: a captured value smuggled into a contract fails to parse.
    expect(() => ActionContractSchema.parse({ ...recordedFill, value: 'Acme' })).toThrow();
    expect(() => ActionContractSchema.parse({ ...recordedFill, target: { ...recordedFill.target, value: 'Acme' } })).toThrow();
  });
});

describe('action contract compatibility matrix', () => {
  it.each([
    ['drift/b2-selector-renamed.html', true],
    ['drift/b2-wrapper-inserted.html', false],
    ['drift/b2-contract-cosmetic.html', true],
  ])('lets %s continue: identity re-resolved, contract unchanged', (fixture, hasCompanyField) => {
    // Identity v2 excludes selectors and wrappers, so these variants carry no
    // contract drift at all: the recorded action is still exactly the live action.
    if (hasCompanyField) {
      const fill = liveContract(fixture, 'fill', baselineCompany);
      expect(fill.resolution.selector).not.toBe('#company-name');
      expect(assertActionContract(recordedFill, fill.contract)).toEqual({ compatible: true, drift: [] });
    }
    const submit = liveContract(fixture, 'click', baselineSubmit);
    const comparison = assertActionContract(recordedSubmit, submit.contract);
    // A new landmark wrapper changes container lineage (identity v2), which is
    // reported as stable_id drift — allowed, because the contract itself is equal.
    expect(comparison.compatible).toBe(true);
    if (comparison.compatible) expect(comparison.drift.every((entry) => entry === 'stable_id')).toBe(true);
  });

  it('stops fill on the same-identity field that became a textarea (Enter no longer submits)', () => {
    const { resolution, contract } = liveContract('drift/b2-contract-textarea.html', 'fill', baselineCompany);
    // Identity resolution succeeds — that is exactly why the contract must decide.
    expect(resolution.selector).toBe('#company-name');
    const comparison = compareActionContracts(recordedFill, contract);
    expect(comparison).toEqual({
      compatible: false,
      classification: 'contract_mismatch',
      mismatches: expect.arrayContaining([
        { field: 'affordance', recorded: 'single_line_text', current: 'multi_line_text' },
        { field: 'affordance', recorded: 'submits_form', current: 'inserts_newline' },
      ]),
    });
    expect(() => assertActionContract(recordedFill, contract)).toThrow(ActionContractMismatchError);
  });

  it('stops the same-named submit whose destination changed', () => {
    const { contract } = liveContract('drift/b2-contract-destination.html', 'click', baselineSubmit);
    const comparison = compareActionContracts(recordedSubmit, contract);
    expect(comparison.compatible).toBe(false);
    if (comparison.compatible) throw new Error('unreachable');
    expect(comparison.mismatches.map((entry) => entry.field)).toEqual(['destination']);
  });

  it('stops the same-named submit that became a POST to a purge endpoint (navigation → mutating)', () => {
    const { resolution, contract } = liveContract('drift/b2-contract-destructive.html', 'click', baselineSubmit);
    expect(resolution.strategy).toBe('stable-id');
    expect(contract.safety).toBe('mutating');
    const comparison = compareActionContracts(recordedSubmit, contract);
    if (comparison.compatible) throw new Error('expected mismatch');
    expect(comparison.mismatches.map((entry) => entry.field)).toEqual(expect.arrayContaining(['destination', 'safety']));
    expect(comparison.mismatches).toContainEqual({ field: 'safety', recorded: 'navigation', current: 'mutating' });
  });

  it('never lets a name change alone block, and never lets a verb or role change pass', () => {
    const renamed = { ...recordedFill, target: { ...recordedFill.target, name: 'Legal company name' } };
    expect(compareActionContracts(recordedFill, renamed)).toEqual({ compatible: true, drift: ['name'] });
    const asLink = { ...recordedSubmit, target: { ...recordedSubmit.target, role: 'link' } };
    expect(compareActionContracts(recordedSubmit, asLink)).toMatchObject({ compatible: false, mismatches: [{ field: 'role' }] });
    const asPress = { ...recordedFill, verb: 'press' as const };
    expect(compareActionContracts(recordedFill, asPress)).toMatchObject({ compatible: false, mismatches: [{ field: 'verb' }] });
    const disabled = { ...recordedSubmit, preconditions: { visible: true as const, enabled: false } };
    expect(compareActionContracts(recordedSubmit, disabled)).toMatchObject({ compatible: false, mismatches: [{ field: 'precondition' }] });
  });

  it('compares required effects only when both sides declare one', () => {
    const withEffect = { ...recordedSubmit, required_effect: { evidence_class: 'fixture_oracle' as const, kind: 'grid_activated' } };
    expect(compareActionContracts(withEffect, recordedSubmit)).toMatchObject({ compatible: true });
    const otherEffect = { ...recordedSubmit, required_effect: { evidence_class: 'fixture_oracle' as const, kind: 'download_requested' } };
    expect(compareActionContracts(withEffect, otherEffect)).toMatchObject({ compatible: false, mismatches: [{ field: 'effect' }] });
  });
});
