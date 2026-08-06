import { describe, expect, it } from 'vitest';
import { assemblePlannerContext, type BrowserAction } from '../../src/index.js';

describe('history compaction recall invariant', () => {
  it('marks compacted-away action detail unavailable instead of implying complete recall', () => {
    const actions: BrowserAction[] = Array.from({ length: 80 }, (_, index) => ({
      kind: 'click',
      selector: `#step-${index}`,
      stableId: index.toString(16).padStart(16, '0').slice(-16),
      role: 'button',
      name: `Step ${index}`,
    }));
    const context = assemblePlannerContext({
      task: 'Complete every required workflow step',
      page: { url: 'https://portal.test/workflow', title: 'Workflow' },
      observation: 'button "Continue" selector=#continue',
      observationMode: 'full',
      previousActions: actions,
    });

    // INVARIANT: B4 may remove recall, but it cannot turn a partial summary into
    // evidence that every earlier procedure detail remains known.
    expect(context.history.compaction).toEqual(expect.objectContaining({
      detailsEvicted: true,
      compactedActionCount: 64,
    }));
    expect(context.volatileSuffix).toContain('older details unavailable');
    expect(context.volatileSuffix).toContain('failureClassification="recall_unavailable"');
    expect(context.volatileSuffix).toContain('do not guess');
    expect(context.history.visibleActions.every((action) => (
      actions.some((original) => JSON.stringify(original) === JSON.stringify(action))
    ))).toBe(true);
  });
});
