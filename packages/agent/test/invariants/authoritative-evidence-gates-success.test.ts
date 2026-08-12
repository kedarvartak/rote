import { describe, expect, it } from 'vitest';
import { buildEvidenceEnvelope, EvidencePolicySchema } from '@rote/core';
import { runBrowserAgent, type BrowserPageSession, type BrowserPlannerClient } from '../../src/index.js';
import { createEvidenceGatedVerifier, createSnapshotEvidenceAdapter, EvidenceCollectionError } from '../../src/evidence.js';

// see docs/05-roadmap.md P2 item 5 (#130) — "harness conclusion, generic DOM
// mutation, stale evidence, and evidence for another task/session all fail".
// This suite drives the full agent loop: the planner concludes success and the
// UI verifier agrees, so the only thing separating success from failure is the
// authoritative evidence gate.

const subject = { task_id: 'grid-contract', run_id: 'run-1' };
const policy = EvidencePolicySchema.parse({ schema_version: 1, required: [{ evidence_class: 'fixture_oracle' }] });

const concludingPlanner: BrowserPlannerClient = {
  async plan(source) {
    return {
      action: { kind: 'done', success: true, summary: 'planner believes the task is complete' },
      usage: { source, input_tokens: 5, output_tokens: 2 },
    };
  },
};

function fixturePage(): BrowserPageSession {
  return {
    async navigate() {},
    async capture() {
      return {
        url: 'https://fixture.test/grid',
        title: 'Grid',
        html: '',
        elements: [{ tag: 'button', attributes: { id: 'row-7' }, text: 'Row 7', depth: 0 }],
      };
    },
    async fill() {},
    async select() {},
    async click() {},
  };
}

function gatedVerifier(read: () => Promise<{ payload: unknown; generation?: number } | undefined>, currentGeneration?: number) {
  return createEvidenceGatedVerifier({
    base: { async verify() { return { success: true, summary: 'ui checks passed' }; } },
    policy,
    adapters: [createSnapshotEvidenceAdapter({
      id: 'fixture-oracle',
      evidenceClass: 'fixture_oracle',
      source: 'http://127.0.0.1/api/oracle',
      read,
      clock: () => 1_000,
    })],
    subject,
    clock: () => 2_000,
    ...(currentGeneration === undefined ? {} : { currentGeneration: async () => currentGeneration }),
  });
}

describe('authoritative evidence gates agent success', () => {
  it('reports clean verification failure when the harness and UI agree but the oracle recorded no effect', async () => {
    const result = await runBrowserAgent({
      task: 'Activate row 7',
      page: fixturePage(),
      planner: concludingPlanner,
      verifier: gatedVerifier(async () => undefined),
      clock: () => 100,
    });
    // INVARIANT: planner conclusion + passing UI checks are prohibited success
    // signals on their own once a task declares an authoritative requirement.
    expect(result.success).toBe(false);
    expect(result.failureClassification).toBe('verification_failed');
    expect(result.summary).toContain('authoritative_effect_missing');
  });

  it('reports clean verification failure when the only evidence belongs to another task', async () => {
    const verifier = createEvidenceGatedVerifier({
      base: { async verify() { return { success: true, summary: 'ui checks passed' }; } },
      policy,
      adapters: [{
        id: 'foreign-oracle',
        async collect() {
          return [
            buildEvidenceEnvelope({
              evidence_class: 'fixture_oracle',
              adapter_id: 'foreign-oracle',
              source: 'http://127.0.0.1/api/oracle?task_id=other-contract',
              subject: { task_id: 'other-contract', run_id: 'run-1' },
              collected_at_ms: 1_000,
              payload: [{ kind: 'grid_activated' }],
            }),
          ];
        },
      }],
      subject,
      clock: () => 2_000,
    });
    const result = await runBrowserAgent({
      task: 'Activate row 7',
      page: fixturePage(),
      planner: concludingPlanner,
      verifier,
      clock: () => 100,
    });
    expect(result.success).toBe(false);
    expect(result.failureClassification).toBe('verification_failed');
    expect(result.summary).toContain('authoritative_evidence_task_mismatch');
  });

  it('reports clean verification failure when the source generation advanced past the evidence', async () => {
    const result = await runBrowserAgent({
      task: 'Activate row 7',
      page: fixturePage(),
      planner: concludingPlanner,
      verifier: gatedVerifier(async () => ({ payload: [{ kind: 'grid_activated' }], generation: 1 }), 2),
      clock: () => 100,
    });
    expect(result.success).toBe(false);
    expect(result.failureClassification).toBe('verification_failed');
    expect(result.summary).toContain('authoritative_evidence_stale');
  });

  it('succeeds only when the oracle attests the effect for this task at the current generation', async () => {
    const result = await runBrowserAgent({
      task: 'Activate row 7',
      page: fixturePage(),
      planner: concludingPlanner,
      verifier: gatedVerifier(async () => ({ payload: [{ kind: 'grid_activated' }], generation: 2 }), 2),
      clock: () => 100,
    });
    expect(result.success).toBe(true);
    expect(result.summary).toContain('authoritative evidence satisfied');
  });

  it('propagates a typed error when the oracle is unreachable instead of classifying the outage', async () => {
    await expect(runBrowserAgent({
      task: 'Activate row 7',
      page: fixturePage(),
      planner: concludingPlanner,
      verifier: gatedVerifier(async () => { throw new Error('ECONNREFUSED'); }),
      clock: () => 100,
    })).rejects.toThrow(EvidenceCollectionError);
  });
});
