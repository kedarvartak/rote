import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import {
  buildPlannerActionHistory,
  DEFAULT_HISTORY_COMPACTION_POLICY,
  HistoryCompactionPolicySchema,
  type BrowserAction,
} from '../src/index.js';

const click = (index: number): BrowserAction => ({
  kind: 'click',
  selector: `#row-${index}`,
  stableId: index.toString(16).padStart(16, '0').slice(-16),
  role: 'button',
  name: `Row ${index}`,
});

describe('buildPlannerActionHistory', () => {
  it('preserves the historical prompt byte-for-byte before the first boundary', () => {
    const actions = Array.from({ length: 24 }, (_, index) => click(index));
    const history = buildPlannerActionHistory(actions);

    expect(history.compaction).toBeUndefined();
    expect(history.visibleActions).toEqual(actions);
    expect(history.text).toBe(actions.map((action) => JSON.stringify(action)).join('\n'));
  });

  it('compacts only on cache-amortized boundaries and keeps the recent tail exact', () => {
    const atFirstBoundary = Array.from({ length: 25 }, (_, index) => click(index));
    const beforeNextBoundary = Array.from({ length: 39 }, (_, index) => click(index));
    const atNextBoundary = Array.from({ length: 40 }, (_, index) => click(index));

    expect(buildPlannerActionHistory(atFirstBoundary).compaction?.compactedActionCount).toBe(16);
    expect(buildPlannerActionHistory(beforeNextBoundary).compaction?.compactedActionCount).toBe(16);
    expect(buildPlannerActionHistory(atNextBoundary).compaction?.compactedActionCount).toBe(32);
    expect(buildPlannerActionHistory(atNextBoundary).visibleActions.slice(-8)).toEqual(atNextBoundary.slice(-8));
  });

  it('keeps the rendered history append-only between compaction boundaries', () => {
    const first = buildPlannerActionHistory(Array.from({ length: 25 }, (_, index) => click(index)));
    const second = buildPlannerActionHistory(Array.from({ length: 26 }, (_, index) => click(index)));

    expect(second.compaction?.historyDigest).toBe(first.compaction?.historyDigest);
    expect(second.text.startsWith(`${first.text}\n`)).toBe(true);
  });

  it('retains only the latest older state-setting action for one target', () => {
    const actions: BrowserAction[] = Array.from({ length: 40 }, (_, index) => ({
      kind: 'fill',
      selector: '#company',
      stableId: 'aaaaaaaaaaaaaaaa',
      role: 'textbox',
      name: 'Company',
      value: `value-${index}`,
    }));
    const history = buildPlannerActionHistory(actions);
    const olderRepresentatives = history.visibleActions.slice(0, -8);

    expect(olderRepresentatives).toEqual([actions[31]]);
    expect(history.text).not.toContain('value-0"');
    expect(history.text).toContain('value-31');
    expect(JSON.stringify(history.compaction)).not.toContain('value-');
  });

  it('retains an explicit unbounded baseline when disabled', () => {
    const actions = Array.from({ length: 100 }, (_, index) => click(index));
    const history = buildPlannerActionHistory(actions, false);
    expect(history.compaction).toBeUndefined();
    expect(history.visibleActions).toHaveLength(100);
  });

  it('rejects schedules that cannot retain a smaller exact tail', () => {
    expect(() => HistoryCompactionPolicySchema.parse({
      maxActionsBeforeCompaction: 8,
      compactionInterval: 4,
      recentActionCount: 8,
      representativeActionLimit: 2,
    })).toThrow(/recentActionCount must be below/);
  });

  it('turns cumulative rendered action-history growth from quadratic to bounded per step', () => {
    const cumulativeChars = (count: number, compact: boolean) => {
      const actions = Array.from({ length: count }, (_, index) => click(index));
      return actions.reduce((total, _action, length) => (
        total + buildPlannerActionHistory(actions.slice(0, length + 1), compact ? undefined : false).text.length
      ), 0);
    };
    const compactRatio = cumulativeChars(200, true) / cumulativeChars(100, true);
    const baselineRatio = cumulativeChars(200, false) / cumulativeChars(100, false);

    expect(compactRatio).toBeLessThan(2.5);
    expect(baselineRatio).toBeGreaterThan(3.5);
  });

  it('is deterministic, bounded in action count, and retains only real actions', () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 0, max: 999 }), { minLength: 25, maxLength: 500 }),
      (indices) => {
        const actions = indices.map(click);
        const first = buildPlannerActionHistory(actions);
        const second = buildPlannerActionHistory(actions);
        const maximumVisible = DEFAULT_HISTORY_COMPACTION_POLICY.representativeActionLimit
          + DEFAULT_HISTORY_COMPACTION_POLICY.recentActionCount
          + DEFAULT_HISTORY_COMPACTION_POLICY.compactionInterval - 1;
        const originals = new Set(actions.map((action) => JSON.stringify(action)));

        expect(second).toEqual(first);
        expect(first.visibleActions.length).toBeLessThanOrEqual(maximumVisible);
        expect(first.text.length).toBeLessThan(8_000);
        expect(first.visibleActions.every((action) => originals.has(JSON.stringify(action)))).toBe(true);
      },
    ));
  });
});
