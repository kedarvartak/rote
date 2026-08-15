import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEFAULT_HISTORY_COMPACTION_POLICY } from '@rote/agent';
import {
  certifyEndurance,
  ENDURANCE_SETTLEDNESS_POLICY,
  EnduranceRunRecordSchema,
  expectedCompactionBoundaries,
  visibleActionBound,
  type EnduranceRunRecord,
  type EnduranceStepSample,
} from '../src/enterprise-endurance.js';

const T34_DATA = fileURLToPath(new URL('../../../docs/testing/data/T34-endurance-certification.json', import.meta.url));

const options = {
  minRuns: 15,
  transitions: 60,
  compactionPolicy: DEFAULT_HISTORY_COMPACTION_POLICY,
  observationMaxChars: 500,
  observationBootstrapMaxChars: 4_000,
  settleTimeoutMs: ENDURANCE_SETTLEDNESS_POLICY.timeoutMs,
};

/** Synthetic run shaped like the real T34 records: sawtooth history, diffs after a bootstrap base. */
function syntheticRun(runIndex: number, mutate: (step: EnduranceStepSample) => EnduranceStepSample = (step) => step): EnduranceRunRecord {
  const steps: EnduranceStepSample[] = [];
  for (let step = 0; step <= 60; step += 1) {
    const actions = step;
    const compactable = actions - DEFAULT_HISTORY_COMPACTION_POLICY.recentActionCount;
    const compacted = actions > DEFAULT_HISTORY_COMPACTION_POLICY.maxActionsBeforeCompaction && compactable > 0
      ? Math.floor(compactable / DEFAULT_HISTORY_COMPACTION_POLICY.compactionInterval) * DEFAULT_HISTORY_COMPACTION_POLICY.compactionInterval
      : 0;
    const visible = compacted > 0 ? Math.min(8, compacted) + (actions - compacted) : actions;
    steps.push(mutate({
      step,
      context_chars: 2_000 + visible * 150,
      volatile_chars: 700 + visible * 150,
      observation_chars: step === 0 ? 560 : 340,
      observation_mode: step === 0 ? 'bootstrap' : 'diff',
      visible_actions: visible,
      compacted_through: compacted > 0 ? compacted - 1 : null,
      route_changed: step > 0,
      document_changed: false,
      settle_ms: step === 60 ? 0 : 200,
      recorder_bytes: 1_200 + step * 1_400,
    }));
  }
  return {
    run_index: runIndex,
    transitions_expected: 60,
    transitions_completed: 60,
    success: true,
    evidence_exact: true,
    dispatch_count: 60,
    steps,
    settle: { samples: 60, total_ms: 12_000, max_ms: 230, timeouts: 0 },
    duration_ms: 13_000,
  };
}

const healthy = Array.from({ length: 15 }, (_, index) => syntheticRun(index));

describe('E7.6 endurance certification (pure)', () => {
  it('derives the B4 visibility bound and boundary count from the frozen policy', () => {
    // 8 representatives + up to 23 exact recent actions just before the next 16-action boundary.
    expect(visibleActionBound(DEFAULT_HISTORY_COMPACTION_POLICY)).toBe(31);
    // 60 actions cross compaction at 16, 32, and 48 compacted actions.
    expect(expectedCompactionBoundaries(DEFAULT_HISTORY_COMPACTION_POLICY, 60)).toBe(3);
    expect(expectedCompactionBoundaries(DEFAULT_HISTORY_COMPACTION_POLICY, 24)).toBe(0);
  });

  it('certifies a healthy 15-run set and reports every check with units', () => {
    const certification = certifyEndurance(healthy, options);
    expect(certification.certified).toBe(true);
    expect(certification.checks.map((check) => check.id)).toEqual([
      'run_count', 'exact_authoritative_success', 'dispatch_count_exact', 'route_epochs_not_navigations',
      'history_bounded_by_policy', 'compaction_boundaries_reported', 'context_peaks_do_not_grow',
      'observation_bounded', 'observation_eviction_exercised', 'settledness_bounded', 'recorder_growth_linear',
    ]);
    expect(certification.metrics.max_visible_actions).toBe(31);
    expect(certification.metrics.compaction_boundaries_per_run).toBe(3);
  });

  it.each([
    ['fewer than 15 runs', healthy.slice(0, 14), 'run_count'],
    ['a run whose oracle events are not exact', [...healthy.slice(0, 14), { ...syntheticRun(14), evidence_exact: false }], 'exact_authoritative_success'],
    ['a run that dispatched an extra action', [...healthy.slice(0, 14), { ...syntheticRun(14), dispatch_count: 61 }], 'dispatch_count_exact'],
    ['a transition rendered as a document change', [...healthy.slice(0, 14), syntheticRun(14, (step) => (step.step === 30 ? { ...step, document_changed: true } : step))], 'route_epochs_not_navigations'],
    ['history growing past the policy bound', [...healthy.slice(0, 14), syntheticRun(14, (step) => (step.step === 59 ? { ...step, visible_actions: 32 } : step))], 'history_bounded_by_policy'],
    ['a missing compaction boundary', [...healthy.slice(0, 14), syntheticRun(14, (step) => (step.compacted_through === 47 ? { ...step, compacted_through: 31 } : step))], 'compaction_boundaries_reported'],
    ['volatile peaks climbing between boundaries', [...healthy.slice(0, 14), syntheticRun(14, (step) => (step.compacted_through === 47 ? { ...step, volatile_chars: step.volatile_chars * 2 } : step))], 'context_peaks_do_not_grow'],
    ['a budgeted observation over budget', [...healthy.slice(0, 14), syntheticRun(14, (step) => (step.step === 10 ? { ...step, observation_chars: 501 } : step))], 'observation_bounded'],
    ['transitions mostly re-snapshotted instead of diffed', [...healthy.slice(0, 14), syntheticRun(14, (step) => (step.step % 2 === 0 ? { ...step, observation_mode: 'bootstrap' } : step))], 'observation_eviction_exercised'],
    ['a settle timeout', [...healthy.slice(0, 14), { ...syntheticRun(14), settle: { samples: 60, total_ms: 12_000, max_ms: 230, timeouts: 1 } }], 'settledness_bounded'],
    ['super-linear recorder growth', [...healthy.slice(0, 14), syntheticRun(14, (step) => (step.step >= 40 ? { ...step, recorder_bytes: step.recorder_bytes + (step.step - 40) * 3_000 } : step))], 'recorder_growth_linear'],
  ])('refuses certification for %s and names the failing check', (_label, records, failingCheck) => {
    const certification = certifyEndurance(records as EnduranceRunRecord[], options);
    expect(certification.certified).toBe(false);
    expect(certification.checks.filter((check) => !check.passed).map((check) => check.id)).toContain(failingCheck);
  });

  it('re-certifies the recorded T34 real-Chrome data set from disk', async () => {
    // The stored report is data, not a claim: recomputing it here keeps the
    // T34 doc honest against the certifier as both evolve.
    const stored = JSON.parse(await readFile(T34_DATA, 'utf8')) as { records: unknown[] };
    const records = stored.records.map((record) => EnduranceRunRecordSchema.parse(record));
    const certification = certifyEndurance(records, options);
    expect(certification.checks.filter((check) => !check.passed)).toEqual([]);
    expect(certification.metrics.runs).toBe(15);
    expect(certification.metrics.transitions_completed_min).toBe(60);
    expect(certification.metrics.document_changes_total).toBe(0);
  });
});
