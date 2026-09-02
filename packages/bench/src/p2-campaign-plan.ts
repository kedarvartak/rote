import { z } from 'zod';
import type { CommandBenchmarkRun } from './command-driver.js';
import { P2CampaignGateSchema, type P2CampaignGate, type P2CampaignProtocol } from './p2-campaign-preflight.js';
import type { BenchPhase } from './types.js';

// see docs/05-roadmap.md "P2 Exit gates" and T43. The frozen protocol
// (`p2-campaign-preflight.ts`) says *what* each gate measures, what evidence a
// cell must produce, and when collection may start. It deliberately carries
// descriptions rather than commands, so nothing executable — and no credential
// — lives in the committed contract.
//
// This module is the missing half: turning that contract into the ordered
// invocations that collect it. Planning stays pure, so the plan can be reviewed
// and diffed before a key is used, and `rehearseP2Campaign` runs the whole
// sequence through an injected runner so the sequencing is proven without spend.
// The protocol remains the single source of truth: gates, repetitions, provider,
// and model are read from it, never redeclared here.

/** Executable detail for one protocol cell; the protocol holds the contract, this holds the argv. */
export const P2CampaignBindingSchema = z.object({
  cellId: z.string().min(1),
  taskId: z.string().min(1),
  prompt: z.string().min(1),
  /** Fixture path or route, resolved against `baseUrl`. */
  path: z.string().min(1),
  verifyText: z.string().min(1),
  params: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
}).strict();
export type P2CampaignBinding = z.infer<typeof P2CampaignBindingSchema>;

export const P2CampaignPlanOptionsSchema = z.object({
  baseUrl: z.string().url(),
  bindings: z.array(P2CampaignBindingSchema).min(1),
  /** Cheaper planner for the routing cell's routing-on half. */
  routineModel: z.string().min(1).optional(),
  routeMinConfidence: z.number().min(0).max(1).optional(),
  /** Brief budget for T2's brief-on half; every other phase pins the brief to 0. */
  siteBriefChars: z.number().int().positive().default(1200),
}).strict();
export type P2CampaignPlanOptions = z.input<typeof P2CampaignPlanOptionsSchema>;

/**
 * What a phase does. `distill` produces no run manifest (so it can never go
 * through the recording executor), and the brief on/off pair is the only place
 * the site brief varies — every other phase pins it off, so T2's variable
 * cannot leak into gates reported separately.
 */
export const P2CampaignPhaseKindSchema = z.enum([
  'cold',
  'distill',
  'warm',
  'brief_off',
  'brief_on',
  'routing_off',
  'routing_on',
  'endurance',
]);
export type P2CampaignPhaseKind = z.infer<typeof P2CampaignPhaseKindSchema>;

/** One concrete invocation: argv is complete, so a reviewer sees exactly what will run. */
export interface P2CampaignRun {
  runId: string;
  repetition: number;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface P2CampaignPhase {
  id: string;
  cellId: string;
  gate: P2CampaignGate;
  kind: P2CampaignPhaseKind;
  taskId: string;
  /** Phase ids that must complete first; always earlier in `plan.phases`. */
  dependsOn: string[];
  /** False for `distill`: it writes no run manifest, so the recording executor must not drive it. */
  records: boolean;
  runs: P2CampaignRun[];
}

export interface P2CampaignPlan {
  protocolId: string;
  protocol: P2CampaignProtocol;
  phases: P2CampaignPhase[];
  /** Provider-billed invocations; distillation is deterministic and free. */
  billedRuns: number;
}

/** A reason the campaign must not be run as planned; preflight reports, never throws. */
export interface P2CampaignPlanProblem {
  code:
    | 'cell_unbound'
    | 'binding_unknown_cell'
    | 'routing_without_routine_model'
    | 'endurance_below_minimum_transitions'
    | 'forward_dependency';
  detail: string;
}

const ROTE_BIN = 'packages/cli/bin/rote.js';

function runArgs(protocol: P2CampaignProtocol, baseUrl: string, binding: P2CampaignBinding, extra: string[]): string[] {
  return [
    ROTE_BIN, 'run', binding.prompt,
    '--url', `${baseUrl.replace(/\/$/, '')}/${binding.path.replace(/^\//, '')}`,
    '--verify-text', binding.verifyText,
    '--model', protocol.model,
    ...(Object.keys(binding.params).length > 0 ? ['--params', JSON.stringify(binding.params)] : []),
    ...extra,
  ];
}

function phaseRuns(
  protocol: P2CampaignProtocol,
  baseUrl: string,
  phaseId: string,
  binding: P2CampaignBinding,
  extra: string[],
): P2CampaignRun[] {
  return Array.from({ length: protocol.repetitions_per_cell }, (_, index) => {
    const repetition = index + 1;
    // Pinned so a later phase (distillation) can address the exact run an
    // earlier phase produced; `rote run` honours ROTE_RUN_ID for this.
    const runId = `${phaseId}-r${repetition}`;
    return { runId, repetition, command: 'node', args: runArgs(protocol, baseUrl, binding, extra), env: { ROTE_RUN_ID: runId } };
  });
}

/**
 * Plans the frozen protocol as an ordered phase list. Pure: no clock, no I/O.
 *
 * Ordering encodes real dependencies. Within T0, `cold → distill → warm` holds
 * because a warm run can only match a playbook distillation already wrote; T2's
 * brief halves depend on T0 having populated site memory for the environment;
 * the routing cell's routing-on half is compared against its own routing-off
 * baseline, so the comparison is paired rather than borrowed from another cell.
 * Every `dependsOn` names a phase earlier in the returned array, and
 * `preflightP2CampaignPlan` re-checks that rather than trusting this function.
 */
export function planP2Campaign(protocol: P2CampaignProtocol, options: P2CampaignPlanOptions): P2CampaignPlan {
  const parsed = P2CampaignPlanOptionsSchema.parse(options);
  const byCell = new Map(parsed.bindings.map((binding) => [binding.cellId, binding]));
  const phases: P2CampaignPhase[] = [];
  const learnedPhaseIds: string[] = [];

  const add = (cell: P2CampaignProtocol['cells'][number], kind: P2CampaignPhaseKind, dependsOn: string[], extra: string[]): string | undefined => {
    const binding = byCell.get(cell.id);
    if (!binding) return undefined;
    const id = `${cell.id}-${kind.replace(/_/g, '-')}`;
    const records = kind !== 'distill';
    phases.push({
      id,
      cellId: cell.id,
      gate: cell.gate,
      kind,
      taskId: binding.taskId,
      dependsOn,
      records,
      runs: records
        ? phaseRuns(protocol, parsed.baseUrl, id, binding, extra)
        : [{
          runId: `${dependsOn[0]}-r1`,
          repetition: 1,
          command: 'node',
          args: [
            ROTE_BIN, 'distill', `${dependsOn[0]}-r1`,
            '--playbook', `campaign-${binding.taskId.toLowerCase()}`,
            ...(Object.keys(binding.params).length > 0 ? ['--params', JSON.stringify(binding.params)] : []),
          ],
          env: {},
        }],
    });
    return id;
  };

  const briefOff = ['--site-brief-chars', '0'];

  // T0 first: it is what populates the library and site memory the later gates read.
  for (const cell of protocol.cells.filter((candidate) => candidate.gate === 't0')) {
    const cold = add(cell, 'cold', [], briefOff);
    if (!cold) continue;
    const distill = add(cell, 'distill', [cold], []);
    const warm = add(cell, 'warm', distill ? [distill] : [cold], briefOff);
    if (warm) learnedPhaseIds.push(warm);
  }
  for (const cell of protocol.cells.filter((candidate) => candidate.gate === 't2')) {
    add(cell, 'brief_off', [...learnedPhaseIds], briefOff);
    add(cell, 'brief_on', [...learnedPhaseIds], ['--site-brief-chars', String(parsed.siteBriefChars)]);
  }
  for (const cell of protocol.cells.filter((candidate) => candidate.gate === 'routing')) {
    const off = add(cell, 'routing_off', [...learnedPhaseIds], briefOff);
    add(cell, 'routing_on', off ? [off] : [...learnedPhaseIds], [
      ...briefOff,
      ...(parsed.routineModel ? ['--routine-model', parsed.routineModel] : []),
      ...(parsed.routeMinConfidence !== undefined ? ['--route-min-confidence', String(parsed.routeMinConfidence)] : []),
    ]);
  }
  for (const cell of protocol.cells.filter((candidate) => candidate.gate === 'b4')) {
    add(cell, 'endurance', [], [...briefOff, '--max-steps', String(cell.minimum_transitions)]);
  }

  const billedRuns = phases.filter((phase) => phase.records).reduce((total, phase) => total + phase.runs.length, 0);
  return { protocolId: protocol.protocol_id, protocol, phases, billedRuns };
}

/**
 * Reports every reason the plan must not be executed, rather than throwing at
 * the first: discovering the second blocker after paying for the first gate is
 * the failure mode this exists to prevent.
 */
export function preflightP2CampaignPlan(plan: P2CampaignPlan, options: P2CampaignPlanOptions): P2CampaignPlanProblem[] {
  const parsed = P2CampaignPlanOptionsSchema.parse(options);
  const problems: P2CampaignPlanProblem[] = [];
  const cellIds = new Set(plan.protocol.cells.map((cell) => cell.id));
  const boundCells = new Set(parsed.bindings.map((binding) => binding.cellId));

  for (const cell of plan.protocol.cells) {
    if (!boundCells.has(cell.id)) {
      problems.push({ code: 'cell_unbound', detail: `protocol cell ${cell.id} (${cell.gate}) has no executable binding, so its gate cannot be collected` });
    }
  }
  for (const binding of parsed.bindings) {
    if (!cellIds.has(binding.cellId)) {
      problems.push({ code: 'binding_unknown_cell', detail: `binding names ${binding.cellId}, which the frozen protocol does not contain` });
    }
  }
  if (plan.phases.some((phase) => phase.kind === 'routing_on') && !parsed.routineModel) {
    problems.push({ code: 'routing_without_routine_model', detail: 'the routing gate compares a routine planner against the frontier; no routine model is specified' });
  }
  for (const cell of plan.protocol.cells.filter((candidate) => candidate.gate === 'b4')) {
    const phase = plan.phases.find((candidate) => candidate.cellId === cell.id && candidate.kind === 'endurance');
    if (!phase) continue;
    const args = phase.runs[0]?.args ?? [];
    const maxSteps = Number(args[args.indexOf('--max-steps') + 1]);
    if (!Number.isFinite(maxSteps) || maxSteps < cell.minimum_transitions) {
      problems.push({ code: 'endurance_below_minimum_transitions', detail: `${cell.id} needs at least ${cell.minimum_transitions} transitions; the plan allows ${args[args.indexOf('--max-steps') + 1] ?? 'none'}` });
    }
  }

  const seen = new Set<string>();
  for (const phase of plan.phases) {
    for (const dependency of phase.dependsOn) {
      if (!seen.has(dependency)) {
        problems.push({ code: 'forward_dependency', detail: `phase ${phase.id} depends on ${dependency}, which does not run before it` });
      }
    }
    seen.add(phase.id);
  }
  return problems;
}

const BENCH_PHASE_BY_KIND: Record<Exclude<P2CampaignPhaseKind, 'distill'>, BenchPhase> = {
  cold: 'cold',
  endurance: 'cold',
  warm: 'warm',
  brief_off: 'cold',
  brief_on: 'warm',
  routing_off: 'warm',
  routing_on: 'warm',
};

/**
 * Converts one recording phase into the existing command-runner plan shape, so
 * billed collection uses the same driver every certified measurement used
 * rather than a second, less-tested path.
 *
 * Throws for `distill`: it writes no run manifest and the recording driver reads
 * one per entry, so handing it over would fail deep in collection instead of here.
 */
export function toCommandPlan(phase: P2CampaignPhase, baseDir: string): { base_dir: string; runs: CommandBenchmarkRun[] } {
  if (!phase.records) throw new Error(`phase ${phase.id} (${phase.kind}) writes no run manifest; execute it directly, not through the recording driver`);
  const benchPhase = BENCH_PHASE_BY_KIND[phase.kind as Exclude<P2CampaignPhaseKind, 'distill'>];
  return {
    base_dir: baseDir,
    runs: phase.runs.map((run) => ({
      task: { id: phase.taskId, name: `${phase.gate} ${phase.kind}` },
      phase: benchPhase,
      repetition: run.repetition,
      command: run.command,
      args: run.args,
      env: run.env,
      run_id: run.runId,
    })),
  };
}

export interface P2CampaignRehearsalPhase {
  phaseId: string;
  gate: P2CampaignGate;
  kind: P2CampaignPhaseKind;
  attempted: number;
  failed: number;
}

export interface P2CampaignRehearsal {
  protocolId: string;
  phases: P2CampaignRehearsalPhase[];
  attempted: number;
  failed: number;
  /** Phase ids in execution order — the property billed collection depends on. */
  order: string[];
  /** True only when every planned phase ran clean. */
  complete: boolean;
}

/** Executes one planned invocation; a rehearsal runner must reach no provider. */
export interface P2CampaignRunner {
  run(context: { phase: P2CampaignPhase; run: P2CampaignRun }): Promise<void>;
}

/**
 * Rehearses the plan in order through an injected runner, stopping at the first
 * failed phase.
 *
 * Stopping is deliberate: every later gate depends on earlier phases having
 * produced runs, so continuing past a broken phase would collect cells that
 * cannot support a claim. A rehearsal that reaches the end proves sequencing and
 * argv shape with no key; billed collection then differs only in which planner
 * answers.
 */
export async function rehearseP2Campaign(plan: P2CampaignPlan, runner: P2CampaignRunner): Promise<P2CampaignRehearsal> {
  const phases: P2CampaignRehearsalPhase[] = [];
  const order: string[] = [];
  let attempted = 0;
  let failed = 0;

  for (const phase of plan.phases) {
    let phaseFailed = 0;
    for (const run of phase.runs) {
      attempted += 1;
      try {
        await runner.run({ phase, run });
      } catch {
        phaseFailed += 1;
        failed += 1;
      }
    }
    phases.push({ phaseId: phase.id, gate: phase.gate, kind: phase.kind, attempted: phase.runs.length, failed: phaseFailed });
    order.push(phase.id);
    if (phaseFailed > 0) break;
  }
  return {
    protocolId: plan.protocolId,
    phases,
    attempted,
    failed,
    order,
    complete: failed === 0 && order.length === plan.phases.length,
  };
}

/** Re-exported so a caller can enumerate gates without importing the contract module directly. */
export const P2_CAMPAIGN_GATES = P2CampaignGateSchema.options;
