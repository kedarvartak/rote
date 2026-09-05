import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseP2CampaignProtocol, type P2CampaignGate, type P2CampaignProtocol } from '../../src/p2-campaign-preflight.js';
import { evaluateP2CampaignGates, type P2CampaignRunRecord } from '../../src/p2-campaign-gates.js';

// SACRED: CLAUDE.md invariant 1 applied to the provider-billed P2 exit campaign.
// A gate verdict is the only thing standing between a $-billed run and a
// published claim, so no degradation of the evidence may ever read as a pass.
//
// The corpus below is enumerated rather than random: each entry names one way
// real collection goes wrong, so a failure points at a scenario, not a seed.

let protocol: P2CampaignProtocol;

beforeAll(async () => {
  protocol = parseP2CampaignProtocol(JSON.parse(await readFile(resolve('../../scripts/bench/p2-campaign/protocol.json'), 'utf8')));
});

const PRICING = '2026-07-15';

function soundCampaign(): P2CampaignRunRecord[] {
  const n = protocol.repetitions_per_cell;
  const id = (gate: P2CampaignGate) => protocol.cells.find((cell) => cell.gate === gate)!.id;
  const minTransitions = protocol.cells.find((cell) => cell.gate === 'b4')!.minimum_transitions;
  const phase = (
    gate: P2CampaignGate,
    phase_kind: P2CampaignRunRecord['phase_kind'],
    build: (repetition: number) => Partial<P2CampaignRunRecord>,
  ): P2CampaignRunRecord[] => Array.from({ length: n }, (_, index) => ({
    cell_id: id(gate),
    gate,
    phase_kind,
    repetition: index + 1,
    success: true,
    logical_input_tokens: 0,
    pricing_table: PRICING,
    ...build(index + 1),
  }));

  return [
    ...phase('t0', 'cold', (r) => ({ logical_input_tokens: 100_000 + r })),
    ...phase('t0', 'warm', (r) => ({ logical_input_tokens: 8_000 + r })),
    ...phase('t2', 'brief_off', (r) => ({ logical_input_tokens: 100_000 + r })),
    ...phase('t2', 'brief_on', (r) => ({ logical_input_tokens: 50_000 + r })),
    ...phase('routing', 'routing_off', (r) => ({ logical_input_tokens: 90_000 + r, warm_steps: 20, frontier_steps: 20 })),
    ...phase('routing', 'routing_on', (r) => ({ logical_input_tokens: 90_000 + r, warm_steps: 20, frontier_steps: 4 })),
    ...phase('b4', 'endurance', () => ({ logical_input_tokens: 400_000, transitions: minTransitions })),
  ];
}

type Mutation = { name: string; apply: (records: P2CampaignRunRecord[]) => P2CampaignRunRecord[] };

const DEGRADATIONS: Mutation[] = [
  { name: 'no runs were collected at all', apply: () => [] },
  { name: 'a whole phase is missing', apply: (rs) => rs.filter((r) => r.phase_kind !== 'warm') },
  { name: 'one repetition short of the protocol count', apply: (rs) => rs.filter((r) => r.repetition < protocol.repetitions_per_cell) },
  { name: 'the subject side failed on one repetition', apply: (rs) => rs.map((r) => (r.phase_kind === 'warm' && r.repetition === 1 ? { ...r, success: false } : r)) },
  { name: 'the baseline side failed on one repetition', apply: (rs) => rs.map((r) => (r.phase_kind === 'cold' && r.repetition === 2 ? { ...r, success: false } : r)) },
  { name: 'every run failed but reported cheap transcripts', apply: (rs) => rs.map((r) => ({ ...r, success: false, logical_input_tokens: 1 })) },
  { name: 'runs span two pricing tables', apply: (rs) => rs.map((r) => (r.repetition === 3 ? { ...r, pricing_table: '2026-01-01' } : r)) },
  { name: 'the routing step split is absent', apply: (rs) => rs.map((r) => (r.phase_kind === 'routing_on' ? { ...r, frontier_steps: undefined } : r)) },
  { name: 'the routing split claims more frontier than warm steps', apply: (rs) => rs.map((r) => (r.phase_kind === 'routing_on' ? { ...r, frontier_steps: 999 } : r)) },
  { name: 'the reduction sits just under the floor', apply: (rs) => rs.map((r) => (r.phase_kind === 'warm' ? { ...r, logical_input_tokens: 30_000 } : r)) },
  { name: 'the campaign is attributed to another cell', apply: (rs) => rs.map((r) => ({ ...r, cell_id: `${r.cell_id}-typo` })) },
];

describe('P2 exit gate — never passes without sound evidence', () => {
  it('passes only when the sound campaign is intact', () => {
    expect(evaluateP2CampaignGates(protocol, soundCampaign()).passed).toBe(true);
  });

  for (const degradation of DEGRADATIONS) {
    it(`refuses the campaign when ${degradation.name}`, () => {
      const result = evaluateP2CampaignGates(protocol, degradation.apply(soundCampaign()));
      expect(result.passed).toBe(false);
    });
  }

  it('never reports a passing gate without a certified interval over the paired evidence', () => {
    for (const degradation of [{ name: 'intact', apply: (rs: P2CampaignRunRecord[]) => rs }, ...DEGRADATIONS]) {
      const result = evaluateP2CampaignGates(protocol, degradation.apply(soundCampaign()));
      for (const gate of result.gates) {
        if (gate.verdict !== 'pass') continue;
        expect(gate.interval, `${gate.gate} passed with no interval (${degradation.name})`).toBeDefined();
        expect(gate.matchedRepetitions).toBeGreaterThanOrEqual(result.minMatchedRepetitions);
        expect(gate.interval!.lower).toBeGreaterThanOrEqual(gate.floor!);
        expect(gate.reasons).toEqual([]);
      }
    }
  });

  it('keeps missing evidence distinct from a lost gate, so a broken campaign is never a design result', () => {
    const absent = evaluateP2CampaignGates(protocol, soundCampaign().filter((r) => r.gate !== 't2'));
    const lost = evaluateP2CampaignGates(protocol, soundCampaign().map((r) => (r.phase_kind === 'brief_on' ? { ...r, logical_input_tokens: 99_000 } : r)));

    expect(absent.gates.find((g) => g.gate === 't2')!.verdict).toBe('not_certifiable');
    expect(lost.gates.find((g) => g.gate === 't2')!.verdict).toBe('fail');
  });

  it('never lets the non-gating B4 report carry the campaign', () => {
    const onlyB4 = soundCampaign().filter((r) => r.gate === 'b4');
    const result = evaluateP2CampaignGates(protocol, onlyB4);

    expect(result.gates.find((g) => g.gate === 'b4')!.verdict).toBe('reported_only');
    expect(result.passed).toBe(false);
  });
});
