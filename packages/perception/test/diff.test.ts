import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  applyObservationDiff,
  diffObservations,
  ObservationDiffError,
  ObservationIdentityError,
  ObservationBootstrapLimitError,
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

  it('bootstraps one grounded oversized snapshot, then returns to a budgeted diff', () => {
    const bootstrap = renderAdaptiveObservation(base, { maxChars: 100 });
    expect(bootstrap.mode).toBe('bootstrap');
    expect(bootstrap.text).toContain('#button-0');
    expect(bootstrap.text.length).toBeGreaterThan(100);
    expect(bootstrap.bootstrap).toEqual({
      budgetChars: 100,
      exceededByChars: bootstrap.text.length - 100,
    });

    const current = base.map((item, index) => index === 3 ? { ...item, selectorHint: '#button-three' } : item);
    const next = renderAdaptiveObservation(current, { previousNodes: base, maxChars: 100 });
    expect(next.mode).toBe('diff');
    expect(next.text.length).toBeLessThanOrEqual(100);
  });

  it('keeps a deterministic 10K-token first page actionable before diffing its next change', () => {
    const heavyweight = Array.from({ length: 800 }, (_, index) => (
      node(index.toString(16).padStart(16, '0'), `Procurement row ${index}`, `#row-${index}`)
    ));
    const bootstrap = renderAdaptiveObservation(heavyweight, { maxChars: 4000 });
    expect(bootstrap.mode).toBe('bootstrap');
    expect(bootstrap.approxTokens).toBeGreaterThan(10_000);
    expect(bootstrap.text).toContain('#row-799');

    const changed = heavyweight.map((item, index) => index === 799 ? { ...item, name: 'Procurement row 799 selected' } : item);
    const next = renderAdaptiveObservation(changed, { previousNodes: heavyweight, maxChars: 4000 });
    expect(next.mode).toBe('diff');
    expect(next.text).toContain('Procurement row 799 selected');
    expect(next.text.length).toBeLessThanOrEqual(4000);
  });

  it('fails cleanly when a grounded snapshot exceeds the bootstrap ceiling', () => {
    expect(() => renderAdaptiveObservation(base, {
      maxChars: 45,
      maxBootstrapChars: 100,
    })).toThrow(ObservationBootstrapLimitError);
  });
});

function node(hash: string, name: string, selectorHint: string): DistilledNode {
  return { id: { hash }, role: 'button', name, tag: 'button', selectorHint, depth: 1, interactive: true };
}
