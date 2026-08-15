import { z } from 'zod';
import {
  ActionContractSchema,
  EnvFingerprintPatternSchema,
  ExpectSchema,
  ParamSchema,
  PlaybookSchema,
  TrajectoryEventSchema,
  type Expect,
  type Playbook,
} from '@rote/core';

// see docs/02-architecture.md "Tiers 1 and 2 — the learning plane" and
// docs/05-roadmap.md P2 item 8 — distiller v1 turns one successful browser
// trajectory into a playbook whose steps carry identity v2 + browsing context +
// action contract (#143), whose expects come only from strong observed effects,
// and whose values are parameterized. Everything here is pure; I/O lives in load.ts.

/** The redacted per-step result the browser-agent recorder writes (subset the distiller reads). */
export const RecordedBrowserStepResultSchema = z.object({
  post_action_evidence: z.object({
    action_kind: z.string(),
    strength: z.enum(['strong', 'reaction']),
    classification: z.string(),
    passed: z.boolean(),
    enforced: z.boolean(),
    target: z.string().optional(),
  }).optional(),
  resolution: z.object({
    selector: z.string().min(1),
    strategy: z.string(),
    stableId: z.string().optional(),
    context: z.object({ contextHash: z.string().length(16), path: z.array(z.unknown()) }).passthrough().optional(),
  }).passthrough().optional(),
  action_contract: ActionContractSchema.optional(),
}).passthrough();
export type RecordedBrowserStepResult = z.infer<typeof RecordedBrowserStepResultSchema>;

/** One trajectory event with its result resolved (inline or from its blob). */
export const DistillableEventSchema = z.object({
  event: TrajectoryEventSchema,
  result: z.unknown(),
});
export type DistillableEvent = z.infer<typeof DistillableEventSchema>;

/** Declared task inputs: the only values allowed to appear in a playbook as `{{name}}`. */
export const DistillParamSchema = ParamSchema.extend({
  /** The concrete value this run used; the distiller replaces it with `{{name}}` and never persists it. */
  value: z.string().min(1),
});
export type DistillParam = z.infer<typeof DistillParamSchema>;

export const DistillOptionsSchema = z.object({
  playbookName: z.string().min(1),
  intentDescription: z.string().min(1),
  envFingerprint: EnvFingerprintPatternSchema,
  params: z.array(DistillParamSchema).default([]),
  /** Final verification is caller-declared: the trajectory does not carry the verifier's checks. */
  verify: z.array(ExpectSchema).min(1),
  /**
   * `fail` (default): a fill/select value that matches no declared param aborts
   * distillation — a playbook must never silently persist a typed value that might
   * be a credential. `allow` persists it literally (explicit opt-in).
   */
  literalValues: z.enum(['fail', 'allow']).default('fail'),
});
export type DistillOptions = z.input<typeof DistillOptionsSchema>;

/** Raised when a dispatched value cannot be parameterized and literals are not allowed; names the step, never the value. */
export class UnparameterizedValueError extends Error {
  constructor(readonly stepId: string, readonly tool: string) {
    super(`step ${stepId} (${tool}) dispatched a value that matches no declared param; declare it or pass literalValues: 'allow'`);
    this.name = 'UnparameterizedValueError';
  }
}

/** Raised when the trajectory has no dispatched browser action to distill. */
export class EmptyTrajectoryError extends Error {
  constructor() {
    super('trajectory contains no dispatched browser action');
    this.name = 'EmptyTrajectoryError';
  }
}

export type PruneReason = 'not_dispatched' | 'terminal_done' | 'superseded_write' | 'unsupported_tool';

export interface DistillReport {
  playbook: Playbook;
  /** Events kept, in playbook order, with the step id they became. */
  kept: Array<{ seq: number; stepId: string }>;
  /** Events dropped and why — pruning is visible, never silent. */
  pruned: Array<{ seq: number; reason: PruneReason }>;
  /** Steps whose args carry a recorded action contract. */
  contractedStepIds: string[];
  /** Params actually referenced by the playbook. */
  usedParams: string[];
}

const ELEMENT_TOOLS = new Set(['browser.fill', 'browser.select', 'browser.click', 'browser.hover', 'browser.press', 'browser.upload', 'browser.dragAndDrop']);

/**
 * Distills a successful browser trajectory into a replayable playbook.
 *
 * Rules (v1, deterministic, no model call):
 * - keep only events whose post-action evidence exists — evidence is derived after
 *   dispatch, so its presence is the record that the action executed; `done`,
 *   pre-dispatch failures, and unknown tools are pruned with a reason;
 * - last write wins: an earlier fill/select on the same target identity is superseded
 *   by a later one (a corrected value), so replay performs the final value once;
 * - identity travels as resolved selector + stableId + role/name/contextHash, and the
 *   recorded action contract is copied verbatim so replay is contract-gated (#143);
 * - `expect` is synthesized only from strong evidence (fill/select value, navigate
 *   URL path); reaction-only evidence never becomes an assertion;
 * - every dispatched value equal to a declared param value becomes `{{name}}`; a
 *   value matching no param fails unless literals are explicitly allowed.
 */
export function distillTrajectory(events: readonly DistillableEvent[], input: DistillOptions): DistillReport {
  const options = DistillOptionsSchema.parse(input);
  const parsed = events.map((entry) => DistillableEventSchema.parse(entry)).sort((a, b) => a.event.seq - b.event.seq);
  const pruned: DistillReport['pruned'] = [];
  const candidates: Array<{ seq: number; tool: string; args: Record<string, unknown>; result: RecordedBrowserStepResult }> = [];

  for (const { event, result } of parsed) {
    if (event.tool === 'browser.done') { pruned.push({ seq: event.seq, reason: 'terminal_done' }); continue; }
    if (event.tool !== 'browser.navigate' && !ELEMENT_TOOLS.has(event.tool)) { pruned.push({ seq: event.seq, reason: 'unsupported_tool' }); continue; }
    const recorded = RecordedBrowserStepResultSchema.safeParse(result ?? {});
    if (!recorded.success || !recorded.data.post_action_evidence) { pruned.push({ seq: event.seq, reason: 'not_dispatched' }); continue; }
    candidates.push({ seq: event.seq, tool: event.tool, args: event.args, result: recorded.data });
  }

  // Last write wins per target identity for fill/select.
  const lastWriteBySelector = new Map<string, number>();
  for (const candidate of candidates) {
    if (candidate.tool !== 'browser.fill' && candidate.tool !== 'browser.select') continue;
    lastWriteBySelector.set(targetKey(candidate.args, candidate.result), candidate.seq);
  }
  const kept = candidates.filter((candidate) => {
    if (candidate.tool !== 'browser.fill' && candidate.tool !== 'browser.select') return true;
    const winner = lastWriteBySelector.get(targetKey(candidate.args, candidate.result));
    if (winner === candidate.seq) return true;
    pruned.push({ seq: candidate.seq, reason: 'superseded_write' });
    return false;
  });
  if (kept.length === 0) throw new EmptyTrajectoryError();

  const usedParams = new Set<string>();
  const contractedStepIds: string[] = [];
  const keptReport: DistillReport['kept'] = [];
  const steps: Playbook['steps'] = [];
  const idCounts = new Map<string, number>();
  let previousId: string | undefined;

  for (const candidate of kept) {
    const verb = candidate.tool.replace(/^browser\./, '');
    const baseId = stepBaseId(verb, candidate.args, candidate.result);
    const count = (idCounts.get(baseId) ?? 0) + 1;
    idCounts.set(baseId, count);
    const id = count === 1 ? baseId : `${baseId}_${count}`;
    const templ = (value: string, allowLiteral: boolean): string => {
      const templated = templateValue(value, options.params, usedParams);
      if (templated.matched || allowLiteral || options.literalValues === 'allow') return templated.text;
      throw new UnparameterizedValueError(id, candidate.tool);
    };

    const args: Record<string, unknown> = {};
    let expect: Expect | undefined;
    if (candidate.tool === 'browser.navigate') {
      const url = String(candidate.args['url'] ?? '');
      // URLs are parameterized by substring (a base_url or id inside a path) but are
      // otherwise legitimately literal — a destination is procedure, not a secret.
      args['url'] = templ(url, true);
      const pathname = safePathname(url);
      if (pathname) expect = { url_contains: templ(pathname, true) };
    } else {
      Object.assign(args, identityArgs(candidate.args, candidate.result));
      if (candidate.tool === 'browser.fill' || candidate.tool === 'browser.select') {
        const value = String(candidate.args['value'] ?? '');
        args['value'] = templ(value, false);
        if (candidate.result.post_action_evidence?.strength === 'strong' && candidate.result.post_action_evidence.passed) {
          expect = { input_value: String(args['selector']), equals: String(args['value']) };
        }
      }
      if (candidate.tool === 'browser.press') args['chord'] = String(candidate.args['chord'] ?? '');
      if (candidate.tool === 'browser.upload') args['fileId'] = String(candidate.args['fileId'] ?? '');
      if (candidate.tool === 'browser.dragAndDrop') {
        args['targetSelector'] = String(candidate.args['targetSelector'] ?? '');
        for (const key of ['targetStableId', 'targetRole', 'targetName', 'targetText']) {
          if (typeof candidate.args[key] === 'string') args[key] = candidate.args[key];
        }
      }
      if (candidate.result.action_contract) {
        args['contract'] = candidate.result.action_contract;
        contractedStepIds.push(id);
      }
    }

    steps.push({
      id,
      kind: 'deterministic',
      tool: candidate.tool === 'browser.dragAndDrop' ? 'browser.drag_and_drop' : candidate.tool,
      args,
      depends_on: previousId ? [previousId] : [],
      ...(expect ? { expect } : {}),
      on_fail: 'fallback',
    });
    keptReport.push({ seq: candidate.seq, stepId: id });
    previousId = id;
  }

  const playbook = PlaybookSchema.parse({
    playbook: options.playbookName,
    version: 1,
    // The task text often names the run's values ("register Acme Tools"); it is
    // templated like every other field so a credential in a task never persists.
    task_signature: { intent_description: templateValue(options.intentDescription, options.params, new Set()).text, env_fingerprint: options.envFingerprint },
    params: options.params.filter((param) => usedParams.has(param.name)).map(({ name, type }) => ({ name, type })),
    steps,
    verify: options.verify,
    confidence: 1,
  });
  // INVARIANT: no declared param value survives literally in a dispatched value,
  // URL, expectation, or the intent text (identity fields such as an accessible
  // name are procedure, not input, and are checked by the contract gate instead).
  for (const param of options.params) {
    for (const leaf of valueLeaves(playbook)) {
      if (leaf.includes(param.value)) throw new UnparameterizedValueError('(playbook)', `value of ${param.name} leaked`);
    }
  }
  return { playbook, kept: keptReport, pruned, contractedStepIds, usedParams: [...usedParams] };
}

/** Strings the playbook would *send or assert* — the places a captured input could leak. */
function valueLeaves(playbook: Playbook): string[] {
  const leaves: string[] = [playbook.task_signature.intent_description];
  // Selector/path fields of an expectation are identity, not input; only the
  // asserted values can carry a typed value.
  const pushExpect = (expect: Expect | undefined) => {
    if (!expect) return;
    for (const key of ['equals', 'url_contains', 'text_visible', 'output_matches']) {
      const value = (expect as Record<string, unknown>)[key];
      if (typeof value === 'string') leaves.push(value);
    }
  };
  for (const step of playbook.steps) {
    if (step.kind === 'deterministic') {
      for (const key of ['value', 'url', 'chord', 'fileId', 'targetSelector']) {
        const value = step.args[key];
        if (typeof value === 'string') leaves.push(value);
      }
    }
    pushExpect(step.expect);
  }
  for (const expect of playbook.verify) pushExpect(expect);
  return leaves;
}

function targetKey(args: Record<string, unknown>, result: RecordedBrowserStepResult): string {
  return result.resolution?.stableId ?? result.resolution?.selector ?? String(args['stableId'] ?? args['selector'] ?? '');
}

function identityArgs(args: Record<string, unknown>, result: RecordedBrowserStepResult): Record<string, unknown> {
  const out: Record<string, unknown> = {
    // The resolved selector is what actually dispatched; the planner's may be stale.
    selector: result.resolution?.selector ?? String(args['selector'] ?? ''),
  };
  const stableId = result.resolution?.stableId ?? (typeof args['stableId'] === 'string' ? args['stableId'] : undefined);
  if (stableId) out['stableId'] = stableId;
  for (const key of ['role', 'name', 'text']) if (typeof args[key] === 'string' && args[key]) out[key] = args[key];
  const contextHash = result.resolution?.context?.path?.length ? result.resolution.context.contextHash : (typeof args['contextHash'] === 'string' ? args['contextHash'] : undefined);
  if (contextHash) out['contextHash'] = contextHash;
  return out;
}

function stepBaseId(verb: string, args: Record<string, unknown>, result: RecordedBrowserStepResult): string {
  const label = typeof args['name'] === 'string' && args['name']
    ? args['name']
    : verb === 'navigate'
      ? safePathname(String(args['url'] ?? '')) ?? 'url'
      : result.resolution?.selector ?? String(args['selector'] ?? 'target');
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'step';
  return `${verb}_${slug}`;
}

/** Replaces every occurrence of a declared param value with `{{name}}` (longest values first). */
function templateValue(value: string, params: readonly DistillParam[], used: Set<string>): { text: string; matched: boolean } {
  let text = value;
  let matched = false;
  for (const param of [...params].sort((a, b) => b.value.length - a.value.length)) {
    if (!text.includes(param.value)) continue;
    text = text.split(param.value).join(`{{${param.name}}}`);
    used.add(param.name);
    matched = true;
  }
  return { text, matched };
}

function safePathname(url: string): string | undefined {
  try {
    return new URL(url).pathname;
  } catch {
    return undefined;
  }
}
