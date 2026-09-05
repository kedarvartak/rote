import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseP2CampaignProtocol, type P2CampaignGate, type P2CampaignProtocol } from '../src/p2-campaign-preflight.js';
import {
  evaluateP2CampaignGates,
  parseP2CampaignRunRecords,
  renderP2CampaignGateResult,
  type P2CampaignRunRecord,
} from '../src/p2-campaign-gates.js';

// Evaluated against the *frozen* protocol in scripts/bench/p2-campaign/protocol.json
// so that a change to the contract's floors fails here rather than after the
// campaign is billed.

let protocol: P2CampaignProtocol;

beforeAll(async () => {
  protocol = parseP2CampaignProtocol(JSON.parse(await readFile(resolve('../../scripts/bench/p2-campaign/protocol.json'), 'utf8')));
});

const PRICING = '2026-07-15';

function cellId(gate: P2CampaignGate): string {
  return protocol.cells.find((cell) => cell.gate === gate)!.id;
}

/** Builds `count` runs of one phase; overrides apply to every run. */
function runs(
  gate: P2CampaignGate,
  phase_kind: P2CampaignRunRecord['phase_kind'],
  count: number,
  build: (repetition: number) => Partial<P2CampaignRunRecord>,
): P2CampaignRunRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    cell_id: cellId(gate),
    gate,
    phase_kind,
    repetition: index + 1,
    success: true,
    logical_input_tokens: 0,
    pricing_table: PRICING,
    ...build(index + 1),
  }));
}

/** A campaign that clears every frozen floor comfortably. */
function passingCampaign(n = 15): P2CampaignRunRecord[] {
  const minTransitions = protocol.cells.find((cell) => cell.gate === 'b4')!.minimum_transitions;
  return [
    ...runs('t0', 'cold', n, (r) => ({ logical_input_tokens: 100_000 + r * 10 })),
    ...runs('t0', 'warm', n, (r) => ({ logical_input_tokens: 10_000 + r })),
    ...runs('t2', 'brief_off', n, (r) => ({ logical_input_tokens: 100_000 + r * 10 })),
    ...runs('t2', 'brief_on', n, (r) => ({ logical_input_tokens: 55_000 + r })),
    ...runs('routing', 'routing_off', n, (r) => ({ logical_input_tokens: 90_000 + r, warm_steps: 20, frontier_steps: 20 })),
    ...runs('routing', 'routing_on', n, (r) => ({ logical_input_tokens: 90_000 + r, warm_steps: 20, frontier_steps: 6 })),
    ...runs('b4', 'endurance', n, () => ({ logical_input_tokens: 400_000, transitions: minTransitions })),
  ];
}

function gateOf(result: ReturnType<typeof evaluateP2CampaignGates>, gate: P2CampaignGate) {
  return result.gates.find((entry) => entry.gate === gate)!;
}

describe('P2 campaign exit gates', () => {
  it('passes every blocking gate on sound evidence and reports B4 without gating', () => {
    const result = evaluateP2CampaignGates(protocol, passingCampaign());

    expect(result.passed).toBe(true);
    expect(gateOf(result, 't0').verdict).toBe('pass');
    expect(gateOf(result, 't2').verdict).toBe('pass');
    expect(gateOf(result, 'routing').verdict).toBe('pass');
    const b4 = gateOf(result, 'b4');
    expect(b4.verdict).toBe('reported_only');
    expect(b4.blocking).toBe(false);
    expect(b4.reasons).toContain('no_floor_defined');
  });

  it('takes every floor from the frozen protocol rather than restating it', () => {
    const result = evaluateP2CampaignGates(protocol, passingCampaign());

    expect(gateOf(result, 't0').floor).toBe(protocol.gates.t0_min_reduction);
    expect(gateOf(result, 't2').floor).toBe(protocol.gates.t2_min_reduction);
    expect(gateOf(result, 'routing').floor).toBe(protocol.gates.routing_min_warm_steps_off_frontier);
    expect(gateOf(result, 'b4').floor).toBeUndefined();
  });

  it('measures routing as the share of warm steps served off the frontier', () => {
    const result = evaluateP2CampaignGates(protocol, passingCampaign());

    // 6 of 20 warm steps stayed on the frontier, so 70% went to the routine model.
    expect(gateOf(result, 'routing').interval?.point).toBeCloseTo(0.7, 6);
  });

  it('reports too few matched repetitions as not certifiable, never as a failure', () => {
    const result = evaluateP2CampaignGates(protocol, passingCampaign(protocol.repetitions_per_cell - 1));

    const t0 = gateOf(result, 't0');
    expect(t0.verdict).toBe('not_certifiable');
    expect(t0.reasons).toEqual(['insufficient_matched_repetitions']);
    expect(t0.interval).toBeUndefined();
    expect(result.passed).toBe(false);
  });

  it('refuses to pair a repetition in which either side failed', () => {
    const records = passingCampaign().map((record) =>
      record.gate === 't0' && record.phase_kind === 'cold' && record.repetition === 1
        ? { ...record, success: false }
        : record);

    const t0 = gateOf(evaluateP2CampaignGates(protocol, records), 't0');
    expect(t0.verdict).toBe('not_certifiable');
    expect(t0.matchedRepetitions).toBe(protocol.repetitions_per_cell - 1);
  });

  it('fails a gate that lost success parity even when the reduction clears the floor', () => {
    const extra = runs('t0', 'warm', 3, (r) => ({ repetition: 100 + r, success: false, logical_input_tokens: 500 }));
    const result = evaluateP2CampaignGates(protocol, [...passingCampaign(), ...extra]);

    const t0 = gateOf(result, 't0');
    expect(t0.verdict).toBe('fail');
    expect(t0.reasons).toContain('success_parity_lost');
    expect(result.passed).toBe(false);
  });

  it('refuses a gate whose runs span more than one pricing table', () => {
    const records = passingCampaign().map((record) =>
      record.gate === 't2' && record.repetition === 2 ? { ...record, pricing_table: '2026-01-01' } : record);

    const t2 = gateOf(evaluateP2CampaignGates(protocol, records), 't2');
    expect(t2.verdict).toBe('not_certifiable');
    expect(t2.reasons).toEqual(['pricing_table_mismatch']);
  });

  it('refuses routing without a warm/frontier step split rather than assuming one', () => {
    const records = passingCampaign().map((record) =>
      record.gate === 'routing' && record.phase_kind === 'routing_on' && record.repetition === 3
        ? { ...record, frontier_steps: undefined }
        : record);

    const routing = gateOf(evaluateP2CampaignGates(protocol, records), 'routing');
    expect(routing.verdict).toBe('not_certifiable');
    expect(routing.reasons).toEqual(['step_telemetry_missing']);
  });

  it('refuses routing telemetry claiming more frontier steps than warm steps', () => {
    const records = passingCampaign().map((record) =>
      record.gate === 'routing' && record.phase_kind === 'routing_on' && record.repetition === 4
        ? { ...record, frontier_steps: 40 }
        : record);

    expect(gateOf(evaluateP2CampaignGates(protocol, records), 'routing').reasons).toEqual(['step_telemetry_missing']);
  });

  it('triggers the T2 retreat rule only on a sound interval below the frozen threshold', () => {
    const weak = passingCampaign().map((record) =>
      record.gate === 't2' && record.phase_kind === 'brief_on'
        ? { ...record, logical_input_tokens: 99_000 + record.repetition }
        : record);

    const t2 = gateOf(evaluateP2CampaignGates(protocol, weak), 't2');
    expect(t2.verdict).toBe('fail');
    expect(t2.retreatTriggered).toBe(true);
    expect(renderP2CampaignGateResult(evaluateP2CampaignGates(protocol, weak))).toContain('Retreat rule triggered');

    // A T2 with no evidence at all is not a killed hypothesis.
    const absent = passingCampaign().filter((record) => record.gate !== 't2');
    const missing = gateOf(evaluateP2CampaignGates(protocol, absent), 't2');
    expect(missing.verdict).toBe('not_certifiable');
    expect(missing.retreatTriggered).toBeUndefined();
  });

  it('reports B4 as not certifiable when runs fall short of the frozen transition minimum', () => {
    const minTransitions = protocol.cells.find((cell) => cell.gate === 'b4')!.minimum_transitions;
    const records = passingCampaign().map((record) =>
      record.gate === 'b4' && record.repetition === 5 ? { ...record, transitions: minTransitions - 1 } : record);

    const b4 = gateOf(evaluateP2CampaignGates(protocol, records), 'b4');
    expect(b4.verdict).toBe('not_certifiable');
    expect(b4.reasons).toEqual(['transitions_below_minimum']);
  });

  it('renders byte-identically for identical input', () => {
    const records = passingCampaign();
    expect(renderP2CampaignGateResult(evaluateP2CampaignGates(protocol, records)))
      .toBe(renderP2CampaignGateResult(evaluateP2CampaignGates(protocol, records)));
  });

  it('parses run records strictly, rejecting an unknown field', () => {
    const [first] = passingCampaign();
    expect(() => parseP2CampaignRunRecords([{ ...first, cost_usd: 1.2 }])).toThrow();
    expect(parseP2CampaignRunRecords([first])).toHaveLength(1);
  });
});
