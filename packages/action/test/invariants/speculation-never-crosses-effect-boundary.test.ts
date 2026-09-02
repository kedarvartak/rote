import { beforeAll, describe, expect, it } from 'vitest';
import {
  SpeculationClassSchema,
  classifySpeculation,
  maySpeculate,
  type SpeculationClass,
} from '../../src/speculation-fence.js';
import { ADVERSARIAL_CATEGORIES, adversarialCorpus, type AdversarialCase } from './speculation-adversarial-corpus.js';

// SACRED INVARIANT (docs/05-roadmap.md P3 exit gates): "zero speculated
// server-mutating calls across the adversarial suite — ever".
//
// The fence is the only thing standing between a predicted action and an early
// dispatch, so this suite tries to get something past it. It runs before any
// speculation mechanism exists, and the mechanism will be required to consult
// the fence rather than re-deriving the decision.

let corpus: AdversarialCase[];

/** Every policy a speculation mechanism could legally hold — `external_effect` is not one. */
const LEGAL_POLICIES: SpeculationClass[][] = [
  [],
  ['pure_read'],
  ['local_nav'],
  ['local_write'],
  ['pure_read', 'local_nav'],
  ['pure_read', 'local_write'],
  ['local_nav', 'local_write'],
  ['pure_read', 'local_nav', 'local_write'],
];

beforeAll(async () => {
  corpus = await adversarialCorpus();
});

describe('speculation never crosses the effect boundary', () => {
  it('covers every category the P3 gate names', () => {
    const covered = new Set(corpus.map((entry) => entry.category));
    for (const category of ADVERSARIAL_CATEGORIES) {
      expect(covered.has(category), `no adversarial case covers ${category}`).toBe(true);
    }
    // Real controls, not only imagined ones.
    expect(corpus.filter((entry) => entry.origin === 'frozen_fixture').length).toBeGreaterThanOrEqual(4);
  });

  it('classifies every adversarial case as an effect boundary, naming the rule that caught it', () => {
    for (const entry of corpus) {
      const verdict = classifySpeculation(entry.input);
      expect(verdict.class, `${entry.id} (${entry.hazard}) was not fenced`).toBe('external_effect');
      // Pinning the reason means a rule change that reclassifies a case is visible
      // in review rather than silently still-passing for a different cause.
      expect(verdict.reason, `${entry.id} was fenced by an unexpected rule`).toBe(entry.expectedReason);
    }
  });

  it('refuses every adversarial case under every legal policy, not merely the default', () => {
    for (const entry of corpus) {
      const verdict = classifySpeculation(entry.input);
      for (const permit of LEGAL_POLICIES) {
        expect(maySpeculate(verdict, { permit }), `${entry.id} slipped through policy [${permit.join(', ')}]`).toBe(false);
      }
    }
  });

  it('is not vacuous: a benign read is still speculable under the default policy', () => {
    // Without this, a fence that refused everything would pass the suite above.
    const benign = classifySpeculation({
      contract: {
        version: 1,
        verb: 'hover',
        target: { role: 'link', name: 'Summary' },
        affordance: { control: 'generic', enter_behavior: 'none', draggable: false },
        safety: 'read',
        preconditions: { visible: true, enabled: true },
      },
    });
    expect(benign.class).toBe('pure_read');
    expect(maySpeculate(benign)).toBe(true);
  });

  it('keeps the class vocabulary closed, so a new class cannot become speculable by default', () => {
    expect(SpeculationClassSchema.options).toEqual(['pure_read', 'local_nav', 'local_write', 'external_effect']);
  });
});
