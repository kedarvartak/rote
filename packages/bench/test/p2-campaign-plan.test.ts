import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseP2CampaignProtocol, type P2CampaignProtocol } from '../src/p2-campaign-preflight.js';
import {
  planP2Campaign,
  preflightP2CampaignPlan,
  rehearseP2Campaign,
  toCommandPlan,
  type P2CampaignPlanOptions,
} from '../src/p2-campaign-plan.js';

// The plan is tested against the *frozen* protocol shipped in
// scripts/bench/p2-campaign/protocol.json, not a fixture invented here, so a
// change to the contract that the planner cannot collect fails this suite
// rather than surfacing after the first billed gate.

let protocol: P2CampaignProtocol;

beforeAll(async () => {
  protocol = parseP2CampaignProtocol(JSON.parse(await readFile(resolve('../../scripts/bench/p2-campaign/protocol.json'), 'utf8')));
});

const binding = (cellId: string, taskId: string, path: string) => ({
  cellId,
  taskId,
  prompt: `Collect ${taskId}`,
  path,
  verifyText: `${taskId} complete`,
  params: { company_name: 'Acme Tools' },
});

function options(overrides: Partial<P2CampaignPlanOptions> = {}): P2CampaignPlanOptions {
  return {
    baseUrl: 'http://127.0.0.1:8080',
    routineModel: 'gpt-5.4-nano',
    routeMinConfidence: 0.9,
    siteBriefChars: 1200,
    bindings: [
      binding('t0-distillation-repeat', 'B2', 'b2-vendor-form.html'),
      binding('t2-novel-known-site', 'B2N', 'b2-vendor-form.html'),
      binding('routing-predictor-real-page', 'WP', 'wp-admin/edit-tags.php'),
      binding('b4-long-run-economics', 'B4', 'b4-triage.html?item=TKT-1041'),
    ],
    ...overrides,
  };
}

describe('P2 campaign plan', () => {
  it('collects every frozen protocol cell, ordering T0 cold → distill → warm', () => {
    const plan = planP2Campaign(protocol, options());
    expect(plan.protocolId).toBe(protocol.protocol_id);
    expect(plan.phases.map((phase) => phase.kind)).toEqual([
      'cold', 'distill', 'warm',
      'brief_off', 'brief_on',
      'routing_off', 'routing_on',
      'endurance',
    ]);
    // Repetitions and model come from the contract, never redeclared by the planner.
    const cold = plan.phases[0]!;
    expect(cold.runs).toHaveLength(protocol.repetitions_per_cell);
    expect(cold.runs[0]?.args).toEqual(expect.arrayContaining(['--model', protocol.model]));
    expect(cold.runs[0]?.env).toEqual({ ROTE_RUN_ID: 't0-distillation-repeat-cold-r1' });
    // Distillation addresses the exact run the cold phase produced.
    const distill = plan.phases[1]!;
    expect(distill.records).toBe(false);
    expect(distill.dependsOn).toEqual(['t0-distillation-repeat-cold']);
    expect(distill.runs[0]?.args).toContain('t0-distillation-repeat-cold-r1');
    expect(plan.phases[2]?.dependsOn).toEqual(['t0-distillation-repeat-distill']);
    // 7 recording phases × 15; the deterministic distill costs nothing.
    expect(plan.billedRuns).toBe(7 * protocol.repetitions_per_cell);
  });

  it('pins the brief off everywhere except T2 brief-on, so generalization cannot leak into other gates', () => {
    const plan = planP2Campaign(protocol, options());
    const briefArg = (kind: string) => {
      const args = plan.phases.find((phase) => phase.kind === kind)!.runs[0]!.args;
      return args[args.indexOf('--site-brief-chars') + 1];
    };
    for (const kind of ['cold', 'warm', 'brief_off', 'routing_off', 'routing_on', 'endurance']) {
      expect(briefArg(kind)).toBe('0');
    }
    expect(briefArg('brief_on')).toBe('1200');
  });

  it('pairs the routing comparison against its own routing-off baseline and carries the routine flags only there', () => {
    const plan = planP2Campaign(protocol, options());
    const off = plan.phases.find((phase) => phase.kind === 'routing_off')!;
    const on = plan.phases.find((phase) => phase.kind === 'routing_on')!;
    expect(on.dependsOn).toEqual([off.id]);
    expect(on.runs[0]?.args).toEqual(expect.arrayContaining(['--routine-model', 'gpt-5.4-nano', '--route-min-confidence', '0.9']));
    expect(off.runs[0]?.args).not.toContain('--routine-model');
  });

  it('gives the B4 cell at least the transitions its protocol row demands', () => {
    const plan = planP2Campaign(protocol, options());
    const endurance = plan.phases.find((phase) => phase.kind === 'endurance')!;
    const cell = protocol.cells.find((candidate) => candidate.gate === 'b4')!;
    const args = endurance.runs[0]!.args;
    expect(Number(args[args.indexOf('--max-steps') + 1])).toBeGreaterThanOrEqual(cell.minimum_transitions);
    expect(preflightP2CampaignPlan(plan, options())).toEqual([]);
  });

  it('reports every blocker at once rather than failing at the first', () => {
    const partial = options({
      routineModel: undefined,
      bindings: [
        binding('t0-distillation-repeat', 'B2', 'b2-vendor-form.html'),
        binding('not-a-protocol-cell', 'X', 'x.html'),
      ],
    });
    const problems = preflightP2CampaignPlan(planP2Campaign(protocol, partial), partial);
    expect(problems.map((problem) => problem.code).sort()).toEqual([
      'binding_unknown_cell',
      'cell_unbound',
      'cell_unbound',
      'cell_unbound',
    ]);
    // An unbound cell names the gate that would go uncollected.
    expect(problems.find((problem) => problem.code === 'cell_unbound')?.detail).toMatch(/cannot be collected/);
  });

  it('refuses a routing gate planned without a routine planner to compare against', () => {
    const noRoutine = options({ routineModel: undefined });
    const problems = preflightP2CampaignPlan(planP2Campaign(protocol, noRoutine), noRoutine);
    expect(problems.map((problem) => problem.code)).toContain('routing_without_routine_model');
  });

  it('catches a forward dependency even in a hand-assembled plan', () => {
    const plan = planP2Campaign(protocol, options());
    const scrambled = { ...plan, phases: [...plan.phases].reverse() };
    expect(preflightP2CampaignPlan(scrambled, options()).some((problem) => problem.code === 'forward_dependency')).toBe(true);
  });

  it('hands recording phases to the existing command driver and refuses the distill phase', () => {
    const plan = planP2Campaign(protocol, options());
    const warm = toCommandPlan(plan.phases.find((phase) => phase.kind === 'warm')!, '.rote');
    expect(warm.base_dir).toBe('.rote');
    expect(warm.runs).toHaveLength(protocol.repetitions_per_cell);
    expect(warm.runs[0]).toMatchObject({ phase: 'warm', repetition: 1, run_id: 't0-distillation-repeat-warm-r1' });
    expect(toCommandPlan(plan.phases.find((phase) => phase.kind === 'cold')!, '.rote').runs[0]?.phase).toBe('cold');
    expect(() => toCommandPlan(plan.phases.find((phase) => phase.kind === 'distill')!, '.rote')).toThrow(/writes no run manifest/);
  });

  it('rehearses the entire plan in dependency order through an injected runner, reaching no provider', async () => {
    const plan = planP2Campaign(protocol, options());
    const seen: string[] = [];
    const rehearsal = await rehearseP2Campaign(plan, { async run({ phase }) { seen.push(phase.id); } });
    expect(rehearsal.complete).toBe(true);
    expect(rehearsal.failed).toBe(0);
    expect(rehearsal.attempted).toBe(plan.billedRuns + 1); // + the one distill invocation
    expect(rehearsal.order).toEqual(plan.phases.map((phase) => phase.id));
    for (const phase of plan.phases) {
      for (const dependency of phase.dependsOn) {
        expect(seen.indexOf(dependency)).toBeLessThan(seen.indexOf(phase.id));
      }
    }
  });

  it('stops at the first failed phase so no later gate collects cells it cannot support', async () => {
    const plan = planP2Campaign(protocol, options());
    const rehearsal = await rehearseP2Campaign(plan, {
      async run({ phase }) { if (phase.kind === 'distill') throw new Error('distillation refused'); },
    });
    expect(rehearsal.complete).toBe(false);
    expect(rehearsal.order).toEqual(['t0-distillation-repeat-cold', 't0-distillation-repeat-distill']);
    expect(rehearsal.phases.at(-1)).toMatchObject({ kind: 'distill', failed: 1 });
  });
});
