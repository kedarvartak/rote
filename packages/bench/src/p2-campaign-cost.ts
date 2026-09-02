import { z } from 'zod';
import type { P2CampaignPhase, P2CampaignPhaseKind, P2CampaignPlan } from './p2-campaign-plan.js';
import { DEFAULT_PRICE_TABLE, priceForModel, runCostUsd, type ModelPrice, type PriceTable } from './pricing.js';

// Budgeting the campaign before approving it. Everything here is a *projection*
// from measured evidence, never a measurement: the numbers the campaign exists
// to produce are exactly the numbers this cannot know. Three rules keep that
// honest:
//
//   1. A phase with no measured profile is reported `unpriced` and contributes
//      nothing, so a total is never quietly understated by a missing input.
//   2. Warm-class phases are bounded, not point-estimated. Their cost is what T0
//      measures; the low bound assumes the gate passes exactly at its target and
//      the high bound assumes it fails entirely (warm costs what cold cost).
//      Approving the high bound is therefore always safe.
//   3. The price table must be the one the protocol declares. Pricing a campaign
//      on a different table than it will be reported with is a silent error, so
//      a mismatch unprices every phase instead of producing a plausible number.

/** Mean per-run token split for one task's cold runs, with the record it came from. */
export const CampaignTokenProfileSchema = z.object({
  taskId: z.string().min(1),
  input_tokens: z.number().nonnegative(),
  cache_read_tokens: z.number().nonnegative(),
  cache_write_tokens: z.number().nonnegative(),
  output_tokens: z.number().nonnegative(),
  /**
   * Dispatched steps the profile was measured over. A phase that must run
   * deeper than this is priced as a *lower bound*, because per-run cost grows
   * with depth (docs/02 "Tier 0": the history term is superlinear in steps).
   */
  steps: z.number().int().positive(),
  /** Frozen test record the means come from, so a reader can re-derive them. */
  source: z.string().min(1),
}).strict();
export type CampaignTokenProfile = z.infer<typeof CampaignTokenProfileSchema>;

/**
 * Profiles derived from frozen certification records rather than typed from
 * memory. `p2-campaign-cost.test.ts` recomputes each from its data file and
 * fails if these drift, so the constant cannot outlive its evidence.
 */
export const MEASURED_CAMPAIGN_PROFILES: readonly CampaignTokenProfile[] = [
  {
    taskId: 'B2',
    input_tokens: 7965.388888888889,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    output_tokens: 387.3333333333333,
    steps: 9,
    source: 'T25 — 18 successful Rote cold runs on corrected B2',
  },
  {
    taskId: 'WP-N25',
    input_tokens: 70826.66666666667,
    cache_read_tokens: 10376.533333333333,
    cache_write_tokens: 0,
    output_tokens: 1006.7333333333333,
    steps: 25,
    source: 'T10 — WP-N25 subject cell, 15 matched repetitions',
  },
];

/** docs/03 "Token reduction … pass ≥80%": the low bound assumes the gate passes at target. */
export const WARM_TARGET_REDUCTION = 0.8;

/**
 * Share of steps a confident prediction routes to the routine model. T39
 * measured 62.4% coverage at confidence ≥0.9 **offline on fixtures**; the
 * campaign is what measures it live, so this only shapes the low bound.
 */
export const DEFAULT_ROUTINE_SHARE = 0.624;

const COLD_CLASS: readonly P2CampaignPhaseKind[] = ['cold', 'brief_off', 'endurance'];
const WARM_CLASS: readonly P2CampaignPhaseKind[] = ['warm', 'brief_on', 'routing_off', 'routing_on'];

export type UnpricedReason = 'no_profile' | 'model_not_priced' | 'pricing_table_mismatch';

export interface P2PhaseCostProjection {
  phaseId: string;
  kind: P2CampaignPhaseKind;
  runs: number;
  priced: boolean;
  usdLow: number;
  usdHigh: number;
  basis?: string;
  unpricedReason?: UnpricedReason;
  /** Set when the profile is shallower than the phase must run; the price is a floor. */
  lowerBound?: { profileSteps: number; requiredSteps: number };
}

export interface P2CampaignCostProjection {
  protocolId: string;
  phases: P2PhaseCostProjection[];
  usdLow: number;
  usdHigh: number;
  /** Phase ids excluded from the totals; nonempty means the totals are partial. */
  unpricedPhaseIds: string[];
  priceTableVersion: string;
  /** True when the table priced with is not the one the protocol declares. */
  pricingTableMismatch: boolean;
  /**
   * Phases priced from a profile measured shallower than the cell demands. Their
   * numbers are floors, not estimates — per-run cost grows with depth.
   */
  lowerBoundPhaseIds: string[];
}

export interface ProjectP2CampaignCostOptions {
  profiles?: readonly CampaignTokenProfile[];
  priceTable?: PriceTable;
  /** Routine planner used by the routing-on phase, when one is planned. */
  routineModel?: string;
  routineShare?: number;
}

/**
 * Projects the campaign's provider spend as a bounded range. Pure.
 *
 * `distill` phases are priced at exactly zero — a fact about distillation (it
 * makes no model call), not an assumption — rather than being reported unpriced.
 */
export function projectP2CampaignCost(plan: P2CampaignPlan, options: ProjectP2CampaignCostOptions = {}): P2CampaignCostProjection {
  const profiles = options.profiles ?? MEASURED_CAMPAIGN_PROFILES;
  const table = options.priceTable ?? DEFAULT_PRICE_TABLE;
  const routineShare = options.routineShare ?? DEFAULT_ROUTINE_SHARE;
  const declared = plan.protocol.pricing_table;
  const mismatch = declared !== `default:${table.version}`;
  const frontier = priceForModel(plan.protocol.model, table);
  const routine = options.routineModel ? priceForModel(options.routineModel, table) : undefined;

  const requiredSteps = new Map(plan.protocol.cells.map((cell) => [cell.id, cell.minimum_transitions]));
  const phases = plan.phases.map((phase) => projectPhase(phase, {
    profiles, frontier, routine, routineShare, mismatch,
    requiredSteps: requiredSteps.get(phase.cellId) ?? 1,
  }));
  const priced = phases.filter((phase) => phase.priced);
  return {
    protocolId: plan.protocolId,
    phases,
    usdLow: priced.reduce((total, phase) => total + phase.usdLow, 0),
    usdHigh: priced.reduce((total, phase) => total + phase.usdHigh, 0),
    unpricedPhaseIds: phases.filter((phase) => !phase.priced).map((phase) => phase.phaseId),
    priceTableVersion: table.version,
    pricingTableMismatch: mismatch,
    lowerBoundPhaseIds: phases.filter((phase) => phase.lowerBound).map((phase) => phase.phaseId),
  };
}

function projectPhase(
  phase: P2CampaignPhase,
  context: {
    profiles: readonly CampaignTokenProfile[];
    frontier: ModelPrice | undefined;
    routine: ModelPrice | undefined;
    routineShare: number;
    mismatch: boolean;
    requiredSteps: number;
  },
): P2PhaseCostProjection {
  const base = { phaseId: phase.id, kind: phase.kind, runs: phase.runs.length };
  const unpriced = (reason: UnpricedReason): P2PhaseCostProjection => ({ ...base, priced: false, usdLow: 0, usdHigh: 0, unpricedReason: reason });

  if (phase.kind === 'distill') {
    return { ...base, priced: true, usdLow: 0, usdHigh: 0, basis: 'deterministic: distillation makes no model call' };
  }
  if (context.mismatch) return unpriced('pricing_table_mismatch');
  if (!context.frontier) return unpriced('model_not_priced');
  const profile = context.profiles.find((candidate) => candidate.taskId === phase.taskId);
  if (!profile) return unpriced('no_profile');

  const coldPerRun = runCostUsd(profile.input_tokens, profile.output_tokens, context.frontier, profile.cache_read_tokens, profile.cache_write_tokens);
  // A cell that must run deeper than its profile was measured is priced as a floor.
  const shallow = profile.steps < context.requiredSteps
    ? { lowerBound: { profileSteps: profile.steps, requiredSteps: context.requiredSteps } }
    : {};
  if (COLD_CLASS.includes(phase.kind)) {
    const total = coldPerRun * phase.runs.length;
    return { ...base, ...shallow, priced: true, usdLow: total, usdHigh: total, basis: `measured cold profile — ${profile.source}` };
  }
  if (!WARM_CLASS.includes(phase.kind)) return unpriced('no_profile');

  // Warm-class: bounded below by the gate's own target and above by "warm saves
  // nothing". The campaign decides where inside that band it lands.
  const warmFactor = 1 - WARM_TARGET_REDUCTION;
  let lowPerRun = coldPerRun * warmFactor;
  if (phase.kind === 'routing_on' && context.routine) {
    const routedPerRun = runCostUsd(
      profile.input_tokens * warmFactor,
      profile.output_tokens * warmFactor,
      context.routine,
      profile.cache_read_tokens * warmFactor,
      profile.cache_write_tokens * warmFactor,
    );
    lowPerRun = lowPerRun * (1 - context.routineShare) + routedPerRun * context.routineShare;
  }
  return {
    ...base,
    ...shallow,
    priced: true,
    usdLow: lowPerRun * phase.runs.length,
    usdHigh: coldPerRun * phase.runs.length,
    basis: phase.kind === 'routing_on' && context.routine
      ? `bounded: gate target with ${(context.routineShare * 100).toFixed(1)}% of steps routed, up to warm-saves-nothing`
      : 'bounded: gate target (≥80% reduction) up to warm-saves-nothing',
  };
}

/** Renders the projection for a human approving a budget. */
export function formatP2CampaignCost(projection: P2CampaignCostProjection): string {
  const usd = (value: number) => `$${value.toFixed(2)}`;
  const lines = [
    `campaign ${projection.protocolId} — projected provider spend ${usd(projection.usdLow)}–${usd(projection.usdHigh)} (prices ${projection.priceTableVersion})`,
  ];
  for (const phase of projection.phases) {
    const floor = phase.lowerBound ? ` [floor: profile measured over ${phase.lowerBound.profileSteps} steps, this cell runs ≥${phase.lowerBound.requiredSteps}]` : '';
    lines.push(phase.priced
      ? `  ${phase.phaseId} (${phase.kind}, ${phase.runs} runs): ${usd(phase.usdLow)}–${usd(phase.usdHigh)} — ${phase.basis}${floor}`
      : `  ${phase.phaseId} (${phase.kind}, ${phase.runs} runs): UNPRICED [${phase.unpricedReason}] — excluded from the total`);
  }
  if (projection.pricingTableMismatch) {
    lines.push('price table does not match the one the protocol declares: nothing is priced until they agree.');
  }
  if (projection.lowerBoundPhaseIds.length > 0) {
    lines.push(`${projection.lowerBoundPhaseIds.length} phase(s) priced from a shallower profile than they run: those figures are floors.`);
  }
  if (projection.unpricedPhaseIds.length > 0) {
    lines.push(`totals are partial: ${projection.unpricedPhaseIds.length} phase(s) unpriced (${projection.unpricedPhaseIds.join(', ')})`);
  }
  lines.push('projection, not measurement: the campaign exists to find the real numbers.');
  return lines.join('\n');
}
