import { describe, expect, it } from 'vitest';
import {
  assemblePlannerContext,
  assertCacheStablePrefix,
  CacheLayoutImmutabilityError,
  type AssemblePlannerContextOptions,
} from '../../src/index.js';

const base: AssemblePlannerContextOptions = {
  task: 'Create one exact tag',
  page: { url: 'https://portal.test/tags', title: 'Tags' },
  observation: 'textbox "Name" selector=#name',
  observationMode: 'full',
  previousActions: [],
};

describe('cache layout immutability', () => {
  it.each([
    ['timestamp', '2026-07-23T12:00:00.000Z'],
    ['runId', 'rote-WP-N25-r01'],
  ])('rejects volatile %s metadata at the context boundary', (field, value) => {
    const contaminated = { ...base, [field]: value } as AssemblePlannerContextOptions;
    expect(() => assemblePlannerContext(contaminated)).toThrow(CacheLayoutImmutabilityError);
  });

  it('fails when any byte above the stable line changes during a run', () => {
    const initial = assemblePlannerContext(base).stablePrefix;
    expect(() => assertCacheStablePrefix(initial, `${initial}\nrun=volatile`)).toThrow(
      'planner stable prefix changed within one run',
    );
  });

  it('allows page, observation, and append-only history churn below the stable line', () => {
    const first = assemblePlannerContext(base);
    const second = assemblePlannerContext({
      ...base,
      page: { url: 'https://portal.test/tags?page=2', title: 'Tags page 2' },
      observation: '+ row "created tag"',
      observationMode: 'diff',
      previousActions: [{ kind: 'fill', selector: '#name', value: 'created tag' }],
    });
    expect(assertCacheStablePrefix(first.stablePrefix, second.stablePrefix)).toBe(first.stablePrefix);
  });
});
