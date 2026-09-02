import { describe, expect, it } from 'vitest';
import { ActionContractVerbSchema, type ActionContract } from '@rote/core';
import {
  SPECULATION_FENCE_VERSION,
  SpeculationClassSchema,
  SpeculationPolicyError,
  SpeculationReasonSchema,
  classifySpeculation,
  maySpeculate,
  speculationAllowed,
  type SpeculationReason,
} from '../src/speculation-fence.js';

// The fence decides what may run before the model has decided to run it. Its
// only interesting property is what it refuses, so most of this suite is
// refusals — and the last test asserts every declared refusal reason is
// actually reachable, so the enum cannot accumulate rules nothing produces.

const SAME_ORIGIN = 'a'.repeat(16);
const DOWNLOAD = 'b'.repeat(16);
const ELSEWHERE = 'c'.repeat(16);

function contract(overrides: Partial<ActionContract> & { affordance?: Partial<ActionContract['affordance']> } = {}): ActionContract {
  const { affordance, ...rest } = overrides;
  return {
    version: 1,
    verb: 'click',
    target: { role: 'button', name: 'Continue' },
    affordance: { control: 'button', enter_behavior: 'none', draggable: false, ...affordance },
    safety: 'potentially_mutating',
    preconditions: { visible: true, enabled: true },
    ...rest,
  } as ActionContract;
}

const seen: SpeculationReason[] = [];
function classify(input: Parameters<typeof classifySpeculation>[0]) {
  const verdict = classifySpeculation(input);
  seen.push(verdict.reason);
  return verdict;
}

const knownDestinations = { knownSameOriginDestinations: [SAME_ORIGIN], downloadDestinations: [DOWNLOAD] };

describe('speculation fence', () => {
  it('lets a hover through as a pure read, and the default policy acts only on that', () => {
    const verdict = classify({ contract: contract({ verb: 'hover', safety: 'read' }) });
    expect(verdict).toEqual({ version: SPECULATION_FENCE_VERSION, class: 'pure_read', reason: 'read_only_verb' });
    expect(maySpeculate(verdict)).toBe(true);
  });

  it('treats a same-origin link click as local navigation — classified safe, still not speculated by default', () => {
    const input = { contract: contract({ affordance: { control: 'link', destination_hash: SAME_ORIGIN } }), ...knownDestinations };
    const verdict = classify(input);
    expect(verdict.class).toBe('local_nav');
    expect(verdict.reason).toBe('same_origin_link');
    // P3.2 prefetches observations only; local_nav becomes eligible in P3.3.
    expect(maySpeculate(verdict)).toBe(false);
    expect(maySpeculate(verdict, { permit: ['pure_read', 'local_nav'] })).toBe(true);
  });

  it('refuses a link whose destination it has not been told is same-origin', () => {
    expect(classify({ contract: contract({ affordance: { control: 'link', destination_hash: ELSEWHERE } }), ...knownDestinations }))
      .toMatchObject({ class: 'external_effect', reason: 'cross_origin_destination' });
  });

  it('refuses a destination known to start a download, and one with no destination at all', () => {
    expect(classify({ contract: contract({ affordance: { control: 'link', destination_hash: DOWNLOAD } }), ...knownDestinations }))
      .toMatchObject({ reason: 'download_destination' });
    expect(classify({ contract: contract({ affordance: { control: 'link' } }), ...knownDestinations }))
      .toMatchObject({ reason: 'unknown_destination' });
  });

  it('refuses a submit control and any control inside a posting form', () => {
    expect(classify({ contract: contract({ affordance: { control: 'submit' } }) })).toMatchObject({ reason: 'submit_control' });
    // The form's method outranks the control: even a checkbox commits here.
    expect(classify({ contract: contract({ affordance: { control: 'checkbox', form_method: 'post' } }) }))
      .toMatchObject({ class: 'external_effect', reason: 'form_method_mutating' });
  });

  it('refuses a plain button, whose handler is page code the fence cannot see', () => {
    expect(classify({ contract: contract({ affordance: { control: 'button' } }) })).toMatchObject({ reason: 'unclassified_control' });
    expect(classify({ contract: contract({ affordance: { control: 'generic' } }) })).toMatchObject({ reason: 'unclassified_control' });
  });

  it('calls local control writes what they are, and refuses a chord that commits', () => {
    for (const verb of ['fill', 'select'] as const) {
      expect(classify({ contract: contract({ verb, affordance: { control: 'single_line_text' } }) }))
        .toMatchObject({ class: 'local_write', reason: 'local_control_write' });
    }
    expect(classify({ contract: contract({ verb: 'press', affordance: { control: 'single_line_text', enter_behavior: 'inserts_newline' } }) }))
      .toMatchObject({ class: 'local_write' });
    expect(classify({ contract: contract({ verb: 'press', affordance: { control: 'single_line_text', enter_behavior: 'submits_form' } }) }))
      .toMatchObject({ class: 'external_effect', reason: 'chord_commits' });
    // A checkbox click is a local write, not a commit.
    expect(classify({ contract: contract({ affordance: { control: 'checkbox' } }) })).toMatchObject({ class: 'local_write' });
  });

  it('refuses uploads and drags outright — their purpose is the transfer', () => {
    for (const verb of ['upload', 'dragAndDrop'] as const) {
      expect(classify({ contract: contract({ verb, safety: 'mutating', affordance: { control: 'file' } }) }))
        .toMatchObject({ class: 'external_effect', reason: 'mutating_verb' });
    }
  });

  it('allows a known same-origin navigation and refuses an unknown one', () => {
    expect(classify({ contract: contract({ verb: 'navigate', safety: 'navigation', affordance: { control: 'generic', destination_hash: SAME_ORIGIN } }), ...knownDestinations }))
      .toMatchObject({ class: 'local_nav', reason: 'same_origin_navigation' });
    expect(classify({ contract: contract({ verb: 'navigate', safety: 'navigation', affordance: { control: 'generic', destination_hash: ELSEWHERE } }), ...knownDestinations }))
      .toMatchObject({ class: 'external_effect' });
  });

  it('checks staleness, ambiguity and preconditions before it looks at the verb', () => {
    // A hover would otherwise be a pure read; the context makes it unsafe.
    const stale = classify({ contract: contract({ verb: 'hover', safety: 'read' }), recordedDocumentGeneration: 3, currentDocumentGeneration: 4 });
    expect(stale).toMatchObject({ class: 'external_effect', reason: 'stale_document' });
    expect(classify({ contract: contract({ verb: 'hover', safety: 'read' }), targetAmbiguous: true }))
      .toMatchObject({ reason: 'ambiguous_target' });
    // Comparing contracts is the action-contract gate's job; the fence only
    // needs to know they disagree.
    expect(classify({ contract: contract({ verb: 'hover', safety: 'read' }), contractMismatch: true }))
      .toMatchObject({ class: 'external_effect', reason: 'contract_mismatch' });
    expect(classify({ contract: contract({ verb: 'hover', safety: 'read', preconditions: { visible: true, enabled: false } }) }))
      .toMatchObject({ reason: 'precondition_unmet' });
    // The same generation is not stale.
    expect(classifySpeculation({ contract: contract({ verb: 'hover', safety: 'read' }), recordedDocumentGeneration: 4, currentDocumentGeneration: 4 }).class).toBe('pure_read');
  });

  it('classifies every verb the contract schema admits, so adding one cannot leave a hole', () => {
    // This is the guard that matters: a verb added to the contract enum without
    // a fence rule falls to the default branch and becomes an effect boundary.
    // If someone adds one and forgets the rule, this still passes — safely —
    // and the reason names the omission.
    for (const verb of ActionContractVerbSchema.options) {
      const verdict = classifySpeculation({ contract: contract({ verb }) });
      expect(verdict.version).toBe(SPECULATION_FENCE_VERSION);
      expect(SpeculationClassSchema.options).toContain(verdict.class);
    }
  });

  it('never lets a policy permit the class it exists to forbid', () => {
    const submit = classifySpeculation({ contract: contract({ affordance: { control: 'submit' } }) });
    expect(maySpeculate(submit, { permit: ['pure_read', 'local_nav', 'local_write'] })).toBe(false);
    expect(() => maySpeculate(submit, { permit: ['external_effect'] })).toThrow(SpeculationPolicyError);
    const { verdict, allowed } = speculationAllowed({ contract: contract({ verb: 'hover', safety: 'read' }) });
    expect(allowed).toBe(true);
    expect(verdict.class).toBe('pure_read');
  });

  it('produces every refusal reason it declares, so the enum carries no dead rules', () => {
    // `unclassified_verb` is unreachable through the schema-validated surface by
    // design, so it is asserted separately as the default branch's contract.
    const reachable = new Set(seen);
    for (const reason of SpeculationReasonSchema.options) {
      if (reason === 'unclassified_verb') continue;
      expect(reachable.has(reason), `no case produced ${reason}`).toBe(true);
    }
  });
});
