import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  applyObservationDiff,
  diffObservations,
  ObservationDiffError,
  ObservationIdentityError,
  renderAdaptiveObservation,
  type DistilledNode,
} from '../src/index.js';

const nodeArbitrary: fc.Arbitrary<DistilledNode> = fc.record({
  id: fc.record({ hash: fc.hexaString({ minLength: 16, maxLength: 16 }) }),
  role: fc.constantFrom('button', 'textbox', 'link', 'heading'),
  name: fc.string({ maxLength: 20 }),
  tag: fc.constantFrom('button', 'input', 'a', 'h2'),
  selectorHint: fc.option(fc.string({ minLength: 1, maxLength: 20 }), { nil: undefined }),
  depth: fc.integer({ min: 0, max: 20 }),
  interactive: fc.boolean(),
});
const observationArbitrary = fc.uniqueArray(nodeArbitrary, {
  selector: (node) => node.id.hash,
  maxLength: 30,
});

describe('observation diffs', () => {
  it('reconstructs the current ordered observation for arbitrary snapshots', () => {
    fc.assert(fc.property(observationArbitrary, observationArbitrary, (base, current) => {
      expect(applyObservationDiff(base, diffObservations(base, current))).toEqual(current);
    }));
  });

  it('rejects duplicate stable IDs instead of corrupting a diff', () => {
    const duplicate = node('aaaaaaaaaaaaaaaa', 'Submit', '#submit');
    expect(() => diffObservations([duplicate, duplicate], [])).toThrow(ObservationIdentityError);
  });

  it('rejects an inconsistent external diff instead of returning partial state', () => {
    const base = [node('aaaaaaaaaaaaaaaa', 'Submit', '#submit')];
    expect(() => applyObservationDiff(base, {
      added: [],
      updated: [],
      removed: ['bbbbbbbbbbbbbbbb'],
      order: ['aaaaaaaaaaaaaaaa'],
    })).toThrow(ObservationDiffError);
  });
});

describe('renderAdaptiveObservation', () => {
  const base = Array.from({ length: 8 }, (_, index) => (
    node(index.toString(16).padStart(16, '0'), `Button ${index}`, `#button-${index}`)
  ));

  it('uses a full observation when it fits', () => {
    const rendered = renderAdaptiveObservation(base, { maxChars: 4000 });

    expect(rendered.mode).toBe('full');
    expect(rendered.truncated).toBe(false);
  });

  it('uses an ordered diff when full state exceeds the budget but changes fit', () => {
    const current = base.map((item, index) => index === 3 ? { ...item, selectorHint: '#button-three' } : item);
    const rendered = renderAdaptiveObservation(current, { previousNodes: base, maxChars: 100 });

    expect(rendered.mode).toBe('diff');
    expect(rendered.text).toContain('#button-three');
    expect(applyObservationDiff(base, rendered.diff!)).toEqual(current);
  });

  it('degrades to a hard-budget summary when neither full nor diff fits', () => {
    const current = base.map((item) => ({ ...item, name: `${item.name} changed substantially` }));
    const rendered = renderAdaptiveObservation(current, { previousNodes: base, maxChars: 45 });

    expect(rendered.mode).toBe('summary');
    expect(rendered.text.length).toBeLessThanOrEqual(45);
    expect(rendered.truncated).toBe(true);
  });
});

function node(hash: string, name: string, selectorHint: string): DistilledNode {
  return { id: { hash }, role: 'button', name, tag: 'button', selectorHint, depth: 1, interactive: true };
}
