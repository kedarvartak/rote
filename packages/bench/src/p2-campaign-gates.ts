import { z } from 'zod';
import { bootstrapMatchedReductionInterval, DEFAULT_CONFIDENCE, DEFAULT_RESAMPLES, type BootstrapOptions, type ReductionInterval } from './competitor-gate.js';
import { P2CampaignPhaseKindSchema, type P2CampaignPhaseKind } from './p2-campaign-plan.js';
import { P2CampaignGateSchema, type P2CampaignGate, type P2CampaignProtocol } from './p2-campaign-preflight.js';

// see docs/03-benchmark.md "Generalization (V2)" — the P2 exit gates and their
// retreat rules; and "Variance: how a win gets certified" — a win is the *lower
// bound* of a seeded bootstrap over at least the protocol's repetition count,
// never a mean and never a single run.

/**
 * One provider-billed run of one campaign phase, as read back from the run
 * manifests the campaign plan writes.
 *
 * Token counts are logical input tokens so the verdict is comparable across the
 * paired phases; cost is deliberately absent, because cache-discounted dollars
 * and logical tokens are different claims (docs/03 "Tokens and dollars are not
 * the same number") and only one of them is gated.
 */
export const P2CampaignRunRecordSchema = z.object({
  cell_id: z.string().min(1),
  gate: P2CampaignGateSchema,
  phase_kind: P2CampaignPhaseKindSchema,
  /** 1-based repetition index; pairing across phases is by this number. */
  repetition: z.number().int().positive(),
  /** Whether the run's authoritative oracle accepted the outcome. */
  success: z.boolean(),
  logical_input_tokens: z.number().nonnegative(),
  /** Steps taken with a learned artifact available; required for the routing gate. */
  warm_steps: z.number().int().nonnegative().optional(),
  /** Warm steps the frontier model planned; the routing gate measures the rest. */
  frontier_steps: z.number().int().nonnegative().optional(),
  /** SPA transitions completed; required for the B4 endurance report. */
  transitions: z.number().int().nonnegative().optional(),
  /** Dated pricing table the run was accounted against. */
  pricing_table: z.string().min(1),
}).strict();
/** One provider-billed campaign run, as the gate evaluator consumes it. */
export type P2CampaignRunRecord = z.infer<typeof P2CampaignRunRecordSchema>;

/**
 * What the evidence supports.
 *
 * `not_certifiable` is deliberately distinct from `fail`: the first says the
 * campaign did not produce enough sound evidence to judge, the second says it
 * did and the gate lost. Collapsing them would let a broken collection read as
 * a design result (CLAUDE.md invariant 1).
 */
export const P2GateVerdictSchema = z.enum(['pass', 'fail', 'not_certifiable', 'reported_only']);
/** Outcome of one P2 exit gate. */
export type P2GateVerdict = z.infer<typeof P2GateVerdictSchema>;

/** Every reason a gate did not pass, so a failed campaign is diagnosable without the raw runs. */
export const P2GateReasonSchema = z.enum([
  'phase_missing',
  'insufficient_matched_repetitions',
  'pricing_table_mismatch',
  'success_parity_lost',
  'below_floor',
  'step_telemetry_missing',
  'transitions_below_minimum',
  'no_floor_defined',
]);
/** Classification of a gate's shortfall. */
export type P2GateReason = z.infer<typeof P2GateReasonSchema>;

/** One evaluated P2 exit gate. */
export interface P2GateResult {
  gate: P2CampaignGate;
  cellId: string;
  verdict: P2GateVerdict;
  /** Whether this gate's verdict decides the campaign; B4 reports without gating. */
  blocking: boolean;
  /** Floor the interval's lower bound had to clear, or undefined when none is frozen. */
  floor?: number;
  /** Undefined when there was not enough sound evidence to estimate one. */
  interval?: ReductionInterval;
  subject: { phase: P2CampaignPhaseKind; runs: number; successes: number };
  baseline?: { phase: P2CampaignPhaseKind; runs: number; successes: number };
  matchedRepetitions: number;
  /**
   * True only for T2, only when the interval is sound and its lower bound falls
   * under the frozen retreat threshold — docs/03's "advisory memory isn't worth
   * its complexity" rule. A `not_certifiable` T2 never triggers a retreat.
   */
  retreatTriggered?: boolean;
  reasons: P2GateReason[];
  detail: string[];
}

/** The campaign's verdict across every frozen P2 exit gate. */
export interface P2CampaignGateResult {
  protocolId: string;
  /** True only when every blocking gate passed; missing evidence never passes. */
  passed: boolean;
  minMatchedRepetitions: number;
  gates: P2GateResult[];
}

export interface P2CampaignGateOptions extends BootstrapOptions {
  /**
   * Matched repetitions required before an interval may be certified. Defaults
   * to the protocol's own `repetitions_per_cell`, which the schema already
   * floors at 15 — so a short campaign reads as `not_certifiable`, not a pass.
   */
  minMatchedRepetitions?: number;
}

/** Raised by the CLI so a failed P2 campaign exits non-zero. */
export class P2CampaignGateFailedError extends Error {
  constructor(readonly result: P2CampaignGateResult) {
    super(renderP2CampaignGateResult(result));
    this.name = 'P2CampaignGateFailedError';
  }
}

/** Which phase supplies the subject and the baseline of each gate's paired comparison. */
const PAIRED_PHASES: Partial<Record<P2CampaignGate, { subject: P2CampaignPhaseKind; baseline: P2CampaignPhaseKind }>> = {
  t0: { subject: 'warm', baseline: 'cold' },
  t2: { subject: 'brief_on', baseline: 'brief_off' },
  routing: { subject: 'routing_on', baseline: 'routing_off' },
};

/**
 * Evaluates the frozen P2 exit gates against a completed provider-billed campaign.
 *
 * Pure and deterministic: callers supply parsed records, and the bootstrap is
 * seeded, so the rendered verdict is byte-stable. It cannot fabricate a pass —
 * absent phases, mixed pricing tables, too few matched repetitions and lost
 * success parity all short-circuit before any interval is reported.
 */
export function evaluateP2CampaignGates(
  protocol: P2CampaignProtocol,
  records: readonly P2CampaignRunRecord[],
  options: P2CampaignGateOptions = {},
): P2CampaignGateResult {
  const minMatchedRepetitions = options.minMatchedRepetitions ?? protocol.repetitions_per_cell;
  const gates = protocol.cells.map((cell) => evaluateGate(protocol, cell, records, minMatchedRepetitions, options));
  const blocking = gates.filter((gate) => gate.blocking);
  return {
    protocolId: protocol.protocol_id,
    passed: blocking.length > 0 && blocking.every((gate) => gate.verdict === 'pass'),
    minMatchedRepetitions,
    gates,
  };
}

function evaluateGate(
  protocol: P2CampaignProtocol,
  cell: P2CampaignProtocol['cells'][number],
  records: readonly P2CampaignRunRecord[],
  minMatchedRepetitions: number,
  options: P2CampaignGateOptions,
): P2GateResult {
  const cellRecords = records.filter((record) => record.cell_id === cell.id && record.gate === cell.gate);
  if (cell.gate === 'b4') return evaluateEnduranceReport(cell, cellRecords, minMatchedRepetitions);

  const floor = floorFor(protocol, cell.gate)!;

  const phases = PAIRED_PHASES[cell.gate]!;
  const subject = cellRecords.filter((record) => record.phase_kind === phases.subject);
  const baseline = cellRecords.filter((record) => record.phase_kind === phases.baseline);
  const base: P2GateResult = {
    gate: cell.gate,
    cellId: cell.id,
    verdict: 'not_certifiable',
    blocking: true,
    floor,
    subject: summarize(phases.subject, subject),
    baseline: summarize(phases.baseline, baseline),
    matchedRepetitions: 0,
    reasons: [],
    detail: [],
  };

  if (subject.length === 0 || baseline.length === 0) {
    return { ...base, reasons: ['phase_missing'], detail: [`missing ${subject.length === 0 ? phases.subject : phases.baseline} runs`] };
  }
  const pricingTables = new Set(cellRecords.map((record) => record.pricing_table));
  if (pricingTables.size > 1) {
    return { ...base, reasons: ['pricing_table_mismatch'], detail: [`runs span ${pricingTables.size} pricing tables`] };
  }

  // Only repetitions where BOTH sides succeeded can be paired: a reduction that
  // counts a failed run's short transcript as a saving is a fabricated win.
  const matched = matchRepetitions(subject, baseline);
  if (matched.length < minMatchedRepetitions) {
    return {
      ...base,
      matchedRepetitions: matched.length,
      reasons: ['insufficient_matched_repetitions'],
      detail: [`${matched.length} matched successful repetitions < ${minMatchedRepetitions}`],
    };
  }

  const reasons: P2GateReason[] = [];
  const detail: string[] = [];
  const subjectRate = successRate(subject);
  const baselineRate = successRate(baseline);
  if (subjectRate < baselineRate) {
    reasons.push('success_parity_lost');
    detail.push(`subject succeeded ${pct(subjectRate)} vs baseline ${pct(baselineRate)}`);
  }

  const measure = cell.gate === 'routing'
    ? routingShare(matched)
    : { subject: matched.map((pair) => pair.subject.logical_input_tokens), baseline: matched.map((pair) => pair.baseline.logical_input_tokens) };
  if ('reason' in measure) {
    return { ...base, matchedRepetitions: matched.length, reasons: [measure.reason], detail: [measure.detail] };
  }

  const interval = bootstrapMatchedReductionInterval(measure.subject, measure.baseline, {
    resamples: options.resamples ?? DEFAULT_RESAMPLES,
    confidence: options.confidence ?? DEFAULT_CONFIDENCE,
    ...(options.seed !== undefined ? { seed: options.seed } : {}),
  });
  if (interval.lower < floor) {
    reasons.push('below_floor');
    detail.push(`lower bound ${pct(interval.lower)} < floor ${pct(floor)}`);
  }

  const result: P2GateResult = {
    ...base,
    verdict: reasons.length === 0 ? 'pass' : 'fail',
    interval,
    matchedRepetitions: matched.length,
    reasons,
    detail,
  };
  if (cell.gate === 't2') {
    // The retreat rule reads the same sound interval as the gate, so an
    // uncertifiable T2 can never be reported as a killed hypothesis.
    result.retreatTriggered = interval.lower < protocol.gates.t2_retreat_below;
    if (result.retreatTriggered) detail.push(`T2 retreat: lower bound ${pct(interval.lower)} < ${pct(protocol.gates.t2_retreat_below)}`);
  }
  return result;
}

/**
 * B4 reports rather than gates: docs/05 requires long-run provider economics to
 * be *measured*, and freezes no floor for them. Inventing one here would publish
 * a threshold no design document ever agreed to.
 */
function evaluateEnduranceReport(
  cell: P2CampaignProtocol['cells'][number],
  records: readonly P2CampaignRunRecord[],
  minMatchedRepetitions: number,
): P2GateResult {
  const endurance = records.filter((record) => record.phase_kind === 'endurance');
  const base: P2GateResult = {
    gate: 'b4',
    cellId: cell.id,
    verdict: 'not_certifiable',
    blocking: false,
    subject: summarize('endurance', endurance),
    matchedRepetitions: 0,
    reasons: [],
    detail: [],
  };
  if (endurance.length === 0) return { ...base, reasons: ['phase_missing'], detail: ['no endurance runs'] };

  const successes = endurance.filter((record) => record.success);
  if (successes.length < minMatchedRepetitions) {
    return {
      ...base,
      matchedRepetitions: successes.length,
      reasons: ['insufficient_matched_repetitions'],
      detail: [`${successes.length} successful endurance runs < ${minMatchedRepetitions}`],
    };
  }
  const missingTransitions = successes.filter((record) => record.transitions === undefined);
  if (missingTransitions.length > 0) {
    return { ...base, matchedRepetitions: successes.length, reasons: ['step_telemetry_missing'], detail: [`${missingTransitions.length} runs report no transition count`] };
  }
  const short = successes.filter((record) => (record.transitions ?? 0) < cell.minimum_transitions);
  if (short.length > 0) {
    return {
      ...base,
      matchedRepetitions: successes.length,
      reasons: ['transitions_below_minimum'],
      detail: [`${short.length} runs below ${cell.minimum_transitions} transitions`],
    };
  }
  return {
    ...base,
    verdict: 'reported_only',
    matchedRepetitions: successes.length,
    reasons: ['no_floor_defined'],
    detail: [`${successes.length} runs ≥ ${cell.minimum_transitions} transitions; docs/05 freezes no B4 floor, so this reports and does not gate`],
  };
}

/**
 * Turns each matched routing pair into the reduction the gate actually wants:
 * `1 - frontier/warm` is the share of warm steps served off the frontier, so the
 * routing gate reuses the same seeded matched bootstrap as the token gates.
 */
function routingShare(
  matched: readonly MatchedPair[],
): { subject: number[]; baseline: number[] } | { reason: P2GateReason; detail: string } {
  const subject: number[] = [];
  const baseline: number[] = [];
  for (const pair of matched) {
    const warm = pair.subject.warm_steps;
    const frontier = pair.subject.frontier_steps;
    if (warm === undefined || frontier === undefined) {
      return { reason: 'step_telemetry_missing', detail: `repetition ${pair.repetition} reports no warm/frontier step split` };
    }
    if (warm === 0) return { reason: 'step_telemetry_missing', detail: `repetition ${pair.repetition} took no warm steps` };
    if (frontier > warm) return { reason: 'step_telemetry_missing', detail: `repetition ${pair.repetition} reports more frontier steps than warm steps` };
    subject.push(frontier);
    baseline.push(warm);
  }
  return { subject, baseline };
}

interface MatchedPair { repetition: number; subject: P2CampaignRunRecord; baseline: P2CampaignRunRecord }

/** Pairs repetitions in which both sides succeeded, in ascending repetition order. */
function matchRepetitions(
  subject: readonly P2CampaignRunRecord[],
  baseline: readonly P2CampaignRunRecord[],
): MatchedPair[] {
  const baselineByRepetition = new Map(baseline.filter((record) => record.success).map((record) => [record.repetition, record]));
  return subject
    .filter((record) => record.success)
    .flatMap((record) => {
      const pair = baselineByRepetition.get(record.repetition);
      return pair ? [{ repetition: record.repetition, subject: record, baseline: pair }] : [];
    })
    .sort((a, b) => a.repetition - b.repetition);
}

/**
 * Reads each gate's floor from the frozen protocol rather than restating it, so
 * the thresholds have exactly one source of truth and a protocol amendment
 * cannot leave a stale number in the evaluator.
 */
function floorFor(protocol: P2CampaignProtocol, gate: P2CampaignGate): number | undefined {
  switch (gate) {
    case 't0': return protocol.gates.t0_min_reduction;
    case 't2': return protocol.gates.t2_min_reduction;
    case 'routing': return protocol.gates.routing_min_warm_steps_off_frontier;
    case 'b4': return undefined;
  }
}

function summarize(phase: P2CampaignPhaseKind, records: readonly P2CampaignRunRecord[]) {
  return { phase, runs: records.length, successes: records.filter((record) => record.success).length };
}

function successRate(records: readonly P2CampaignRunRecord[]): number {
  if (records.length === 0) return 0;
  return records.filter((record) => record.success).length / records.length;
}

/** Deterministically renders the campaign verdict for humans and CI logs. */
export function renderP2CampaignGateResult(result: P2CampaignGateResult): string {
  const lines = [
    `P2 exit gates (${result.protocolId}): ${result.passed ? 'PASS' : 'FAIL'} (min ${result.minMatchedRepetitions} matched repetitions)`,
    '',
    '| Gate | Verdict | Measure (range) | Floor | Matched | Gating | Reasons |',
    '|---|---|---:|---:|---:|---|---|',
  ];
  for (const gate of [...result.gates].sort((a, b) => a.gate.localeCompare(b.gate))) {
    const range = gate.interval
      ? `${pct(gate.interval.point)} [${pct(gate.interval.lower)}–${pct(gate.interval.upper)}]`
      : 'not estimated';
    lines.push(
      `| ${gate.gate} | ${gate.verdict} | ${range} | ${gate.floor === undefined ? '—' : pct(gate.floor)} | ${gate.matchedRepetitions} | ${gate.blocking ? 'yes' : 'no'} | ${cell(gate.detail.join('; ') || gate.reasons.join('; ') || 'ok')} |`,
    );
  }
  if (result.gates.length === 0) lines.push('| — | not_certifiable | not estimated | — | 0 | yes | no campaign cells |');
  const retreat = result.gates.find((gate) => gate.retreatTriggered);
  if (retreat) {
    lines.push('', 'Retreat rule triggered: the T2 lower bound is under the protocol\'s retreat threshold — docs/03 says retreat to a replay tool, not a project kill.');
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|');
}

/** Parses campaign run records without dropping malformed rows. */
export function parseP2CampaignRunRecords(input: unknown): P2CampaignRunRecord[] {
  return z.array(P2CampaignRunRecordSchema).parse(input);
}
