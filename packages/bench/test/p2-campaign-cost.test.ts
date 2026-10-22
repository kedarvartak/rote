import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseP2CampaignProtocol, type P2CampaignProtocol } from '../src/p2-campaign-preflight.js';
import { planP2Campaign, type P2CampaignPlanOptions } from '../src/p2-campaign-plan.js';
import {
  DEFAULT_ROUTINE_SHARE,
  MEASURED_CAMPAIGN_PROFILES,
  WARM_TARGET_REDUCTION,
  formatP2CampaignCost,
  projectP2CampaignCost,
} from '../src/p2-campaign-cost.js';
import { DEFAULT_PRICE_TABLE, PriceTableSchema } from '../src/pricing.js';

// A budget is only useful if it cannot be quietly wrong. These tests pin the
// three ways this projection refuses to flatter itself: profiles are re-derived
// from the frozen records they cite, missing inputs leave the total explicitly
// partial rather than small, and a price table that is not the protocol's
// unprices everything.

let protocol: P2CampaignProtocol;

beforeAll(async () => {
  protocol = parseP2CampaignProtocol(JSON.parse(await readFile(resolve('../../scripts/bench/p2-campaign/protocol.json'), 'utf8')));
});

const binding = (cellId: string, taskId: string) => ({
  cellId, taskId, prompt: `Collect ${taskId}`, path: `${taskId}.html`, verifyText: `${taskId} complete`, params: {},
});

function options(overrides: Partial<P2CampaignPlanOptions> = {}): P2CampaignPlanOptions {
  return {
    baseUrl: 'http://127.0.0.1:8080',
    routineModel: 'gpt-5.4-nano',
    routeMinConfidence: 0.9,
    bindings: [
      binding('t0-distillation-repeat', 'B2'),
      binding('t2-novel-known-site', 'B2'),
      binding('routing-predictor-real-page', 'B2'),
      binding('b4-long-run-economics', 'B2'),
    ],
    ...overrides,
  };
}

describe('P2 campaign cost projection', () => {
  it('derives its B2 profile from the frozen T25 records rather than a typed-in number', async () => {
    const records = JSON.parse(await readFile(resolve('../../docs/testing/data/T25-browser-use-0137-certification-records.json'), 'utf8')) as Array<Record<string, number | string>>;
    const cold = records.filter((record) => record['harness'] === 'rote' && record['outcome'] === 'success');
    expect(cold).toHaveLength(18);
    const mean = (field: string) => cold.reduce((total, record) => total + Number(record[field]), 0) / cold.length;
    const profile = MEASURED_CAMPAIGN_PROFILES.find((candidate) => candidate.taskId === 'B2')!;
    expect(profile.input_tokens).toBeCloseTo(mean('input_tokens'), 6);
    expect(profile.cache_read_tokens).toBeCloseTo(mean('cache_read_tokens'), 6);
    expect(profile.cache_write_tokens).toBeCloseTo(mean('cache_write_tokens'), 6);
    expect(profile.output_tokens).toBeCloseTo(mean('output_tokens'), 6);
  });

  it('derives its real-page profile from the frozen T10 curve summary', async () => {
    const summary = JSON.parse(await readFile(resolve('../../docs/testing/data/T10-g1-curve-summary.json'), 'utf8')) as { cells: Array<{ task_id: string; subject: Record<string, number> }> };
    const cell = summary.cells.find((candidate) => candidate.task_id === 'WP-N25')!;
    const profile = MEASURED_CAMPAIGN_PROFILES.find((candidate) => candidate.taskId === 'WP-N25')!;
    expect(profile.input_tokens).toBeCloseTo(cell.subject['mean_uncached_input_tokens']!, 6);
    expect(profile.cache_read_tokens).toBeCloseTo(cell.subject['mean_cache_read_tokens']!, 6);
    expect(profile.output_tokens).toBeCloseTo(cell.subject['mean_output_tokens']!, 6);
  });

  it('prices cold-class phases exactly and bounds warm-class phases by the gate target', () => {
    const plan = planP2Campaign(protocol, options());
    const projection = projectP2CampaignCost(plan, { routineModel: 'gpt-5.4-nano' });
    const cold = projection.phases.find((phase) => phase.kind === 'cold')!;
    expect(cold.priced).toBe(true);
    // A cold run's cost is measured, so its bounds coincide.
    expect(cold.usdLow).toBeCloseTo(cold.usdHigh, 12);
    expect(cold.basis).toContain('T25');

    const warm = projection.phases.find((phase) => phase.kind === 'warm')!;
    expect(warm.usdHigh).toBeCloseTo(cold.usdHigh, 12); // warm saves nothing → cold's cost
    expect(warm.usdLow).toBeCloseTo(cold.usdHigh * (1 - WARM_TARGET_REDUCTION), 12);
    expect(projection.usdLow).toBeLessThan(projection.usdHigh);
  });

  it('prices distillation at zero because it makes no model call', () => {
    const plan = planP2Campaign(protocol, options());
    const projection = projectP2CampaignCost(plan);
    const distill = projection.phases.find((phase) => phase.kind === 'distill')!;
    expect(distill).toMatchObject({ priced: true, usdLow: 0, usdHigh: 0 });
    expect(distill.basis).toContain('no model call');
  });

  it('routes part of the routing-on low bound to the cheaper planner, and only that phase', () => {
    const plan = planP2Campaign(protocol, options());
    const withRoutine = projectP2CampaignCost(plan, { routineModel: 'gpt-5.4-nano' });
    const withoutRoutine = projectP2CampaignCost(plan, {});
    const on = (projection: typeof withRoutine) => projection.phases.find((phase) => phase.kind === 'routing_on')!;
    const off = (projection: typeof withRoutine) => projection.phases.find((phase) => phase.kind === 'routing_off')!;
    expect(on(withRoutine).usdLow).toBeLessThan(on(withoutRoutine).usdLow);
    expect(on(withRoutine).basis).toContain(`${(DEFAULT_ROUTINE_SHARE * 100).toFixed(1)}%`);
    // The routing-off baseline is an ordinary warm run either way.
    expect(off(withRoutine).usdLow).toBeCloseTo(off(withoutRoutine).usdLow, 12);
    // The high bound never assumes routing helps.
    expect(on(withRoutine).usdHigh).toBeCloseTo(on(withoutRoutine).usdHigh, 12);
  });

  it('leaves a phase with no measured profile unpriced, and says the total is partial', () => {
    const plan = planP2Campaign(protocol, options({
      bindings: [
        binding('t0-distillation-repeat', 'B2'),
        binding('t2-novel-known-site', 'NOVEL'),
        binding('routing-predictor-real-page', 'B2'),
        binding('b4-long-run-economics', 'B2'),
      ],
    }));
    const projection = projectP2CampaignCost(plan, { routineModel: 'gpt-5.4-nano' });
    const unpriced = projection.phases.filter((phase) => !phase.priced);
    expect(unpriced.map((phase) => phase.kind).sort()).toEqual(['brief_off', 'brief_on']);
    expect(unpriced.every((phase) => phase.unpricedReason === 'no_profile')).toBe(true);
    // Unpriced phases contribute nothing, so the total cannot be quietly understated.
    expect(projection.unpricedPhaseIds).toHaveLength(2);
    expect(formatP2CampaignCost(projection)).toContain('totals are partial');
  });

  it('unprices everything when the price table is not the one the protocol declares', () => {
    const plan = planP2Campaign(protocol, options());
    const stale = PriceTableSchema.parse({ ...DEFAULT_PRICE_TABLE, version: '1999-01-01' });
    const projection = projectP2CampaignCost(plan, { priceTable: stale });
    expect(projection.pricingTableMismatch).toBe(true);
    expect(projection.usdLow).toBe(0);
    expect(projection.usdHigh).toBe(0);
    // Distillation is still free — that is a fact, not a price lookup.
    expect(projection.phases.filter((phase) => phase.priced).map((phase) => phase.kind)).toEqual(['distill']);
    expect(formatP2CampaignCost(projection)).toContain('does not match the one the protocol declares');
  });

  it('prices a cell that must run deeper than its profile as a floor, and says so', () => {
    const plan = planP2Campaign(protocol, options());
    const projection = projectP2CampaignCost(plan, { routineModel: 'gpt-5.4-nano' });
    const b4Cell = protocol.cells.find((cell) => cell.gate === 'b4')!;
    const endurance = projection.phases.find((phase) => phase.kind === 'endurance')!;
    // B2's profile is 9 steps deep; the B4 cell runs at least 50.
    expect(endurance.lowerBound).toEqual({ profileSteps: 9, requiredSteps: b4Cell.minimum_transitions });
    expect(projection.lowerBoundPhaseIds).toContain(endurance.phaseId);
    const text = formatP2CampaignCost(projection);
    expect(text).toContain(`this cell runs ≥${b4Cell.minimum_transitions}`);
    expect(text).toContain('those figures are floors');
    // A cell whose profile is deep enough is not flagged.
    expect(projection.phases.find((phase) => phase.kind === 'cold')?.lowerBound).toBeUndefined();
  });

  it('renders a budget a human can approve, and never calls itself a measurement', () => {
    const plan = planP2Campaign(protocol, options());
    const text = formatP2CampaignCost(projectP2CampaignCost(plan, { routineModel: 'gpt-5.4-nano' }));
    expect(text).toMatch(/projected provider spend \$\d+\.\d\d–\$\d+\.\d\d/);
    expect(text).toContain('prices 2026-07-15');
    expect(text).toContain('projection, not measurement');
  });
});
