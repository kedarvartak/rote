import { z } from 'zod';
import {
  SpeculationInputSchema,
  classifySpeculation,
  maySpeculate,
  type ActionContract,
} from '@rote/action';
import { DigestSchema, SessionScopeSchema, type SessionScope } from './session-scope.js';

/** P3.3 policy is explicit and versioned; external effects can never be enabled. */
export const EffectFencePolicySchema = z.object({
  version: z.literal(1).default(1),
  permit: z.array(z.enum(['pure_read', 'local_nav'])).default(['pure_read', 'local_nav']),
  max_dispatches: z.number().int().positive().default(8),
  max_in_flight: z.number().int().positive().default(1),
  max_duration_ms: z.number().int().positive().default(5_000),
}).strict();
export type EffectFencePolicy = z.input<typeof EffectFencePolicySchema>;

export const EffectFencedRequestSchema = z.object({
  shadow_id: z.string().min(1),
  scope: SessionScopeSchema,
  shadow_epoch: z.number().int().nonnegative(),
  document_generation: z.number().int().nonnegative(),
  context_generation: z.number().int().nonnegative(),
  fingerprint_digest: DigestSchema,
  action_contract_digest: DigestSchema,
  verification_plan_digest: DigestSchema,
  prediction_digest: DigestSchema,
  source: z.enum(['model', 'heuristic', 'replay']),
  action: SpeculationInputSchema,
}).strict();
export type EffectFencedRequest = z.input<typeof EffectFencedRequestSchema>;

/** A receipt contains references only; it cannot carry a success claim or page value. */
export const EffectFencedReceiptSchema = z.object({
  observation_digest: DigestSchema,
  scope: SessionScopeSchema,
  shadow_epoch: z.number().int().nonnegative(),
  document_generation: z.number().int().nonnegative(),
  context_generation: z.number().int().nonnegative(),
  fingerprint_digest: DigestSchema,
  action_contract_digest: DigestSchema,
  verification_plan_digest: DigestSchema,
}).strict();
export type EffectFencedReceipt = z.infer<typeof EffectFencedReceiptSchema>;

export interface EffectFencedExecutor<Observation = unknown> {
  /** The executor is the only dispatch boundary and accepts only a fenced action contract. */
  dispatch(input: { shadow_id: string; action: ActionContract; effect_class: 'pure_read' | 'local_nav' }): Promise<{ observation: Observation; receipt: EffectFencedReceipt }>;
}

export const EffectFencedFailureSchema = z.enum([
  'invalid_request',
  'effect_boundary',
  'budget_exhausted',
  'dispatch_failed',
  'stale_context',
  'scope_mismatch',
  'fingerprint_mismatch',
  'contract_mismatch',
  'verification_plan_mismatch',
  'prediction_miss',
  'promotion_rejected',
]);
export type EffectFencedFailure = z.infer<typeof EffectFencedFailureSchema>;

export const EffectFencedEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  kind: z.enum(['promoted', 'discarded']),
  source: z.enum(['model', 'heuristic', 'replay']),
  shadow_id: z.string().min(1),
  effect_class: z.enum(['pure_read', 'local_nav']).optional(),
  failure: EffectFencedFailureSchema.optional(),
}).strict();
export type EffectFencedEvent = z.infer<typeof EffectFencedEventSchema>;

export type EffectFencedOutcome<Observation> =
  | { kind: 'promoted'; observation: Observation }
  | { kind: 'discarded'; failure: EffectFencedFailure };

/**
 * Enforces the single-step P3.3 boundary. It never dispatches an unclassified
 * action, never treats a shadow receipt as final verification, and promotes
 * only an exact receipt through the injected atomic promotion callback.
 */
export class EffectFencedSpeculator<Observation = unknown> {
  private readonly events: EffectFencedEvent[] = [];
  private nextSeq = 0;
  private dispatches = 0;
  private inFlight = 0;

  private readonly policy: z.infer<typeof EffectFencePolicySchema>;

  constructor(
    private readonly executor: EffectFencedExecutor<Observation>,
    private readonly promoteShadow: (shadowId: string) => Promise<void>,
    policy: EffectFencePolicy = {},
  ) {
    this.policy = EffectFencePolicySchema.parse(policy);
  }

  async speculate(input: unknown): Promise<EffectFencedOutcome<Observation>> {
    const parsed = EffectFencedRequestSchema.safeParse(input);
    if (!parsed.success) return this.discard('unknown', 'heuristic', 'invalid_request');
    const request = parsed.data;
    const verdict = classifySpeculation(request.action);
    if (!maySpeculate(verdict, { permit: this.policy.permit })) return this.discard(request.shadow_id, request.source, 'effect_boundary');
    if (verdict.class !== 'pure_read' && verdict.class !== 'local_nav') return this.discard(request.shadow_id, request.source, 'effect_boundary');
    if (this.dispatches >= this.policy.max_dispatches || this.inFlight >= this.policy.max_in_flight) {
      return this.discard(request.shadow_id, request.source, 'budget_exhausted');
    }

    this.dispatches += 1;
    this.inFlight += 1;
    try {
      const result = await withTimeout(
        this.executor.dispatch({ shadow_id: request.shadow_id, action: request.action.contract, effect_class: verdict.class }),
        this.policy.max_duration_ms,
      );
      const receipt = EffectFencedReceiptSchema.safeParse(result.receipt);
      if (!receipt.success) return this.discard(request.shadow_id, request.source, 'stale_context');
      const failure = receiptFailure(request, receipt.data);
      if (failure) return this.discard(request.shadow_id, request.source, failure);
      if (receipt.data.observation_digest !== request.prediction_digest) return this.discard(request.shadow_id, request.source, 'prediction_miss');
      try {
        await this.promoteShadow(request.shadow_id);
      } catch {
        return this.discard(request.shadow_id, request.source, 'promotion_rejected');
      }
      this.record({ kind: 'promoted', source: request.source, shadow_id: request.shadow_id, effect_class: verdict.class });
      return { kind: 'promoted', observation: result.observation };
    } catch {
      return this.discard(request.shadow_id, request.source, 'dispatch_failed');
    } finally {
      this.inFlight -= 1;
    }
  }

  lifecycle(): EffectFencedEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  budget(): { dispatches: number; in_flight: number; max_dispatches: number; max_in_flight: number } {
    return { dispatches: this.dispatches, in_flight: this.inFlight, max_dispatches: this.policy.max_dispatches, max_in_flight: this.policy.max_in_flight };
  }

  private discard(shadowId: string, source: 'model' | 'heuristic' | 'replay', failure: EffectFencedFailure): EffectFencedOutcome<Observation> {
    this.record({ kind: 'discarded', source, shadow_id: shadowId, failure });
    return { kind: 'discarded', failure };
  }

  private record(event: Omit<EffectFencedEvent, 'seq'>): void {
    this.events.push(EffectFencedEventSchema.parse({ seq: this.nextSeq++, ...event }));
  }
}

function receiptFailure(request: z.infer<typeof EffectFencedRequestSchema>, receipt: EffectFencedReceipt): EffectFencedFailure | undefined {
  if (request.shadow_epoch !== receipt.shadow_epoch || request.document_generation !== receipt.document_generation || request.context_generation !== receipt.context_generation) return 'stale_context';
  if (!sameScope(request.scope, receipt.scope)) return 'scope_mismatch';
  if (request.fingerprint_digest !== receipt.fingerprint_digest) return 'fingerprint_mismatch';
  if (request.action_contract_digest !== receipt.action_contract_digest) return 'contract_mismatch';
  if (request.verification_plan_digest !== receipt.verification_plan_digest) return 'verification_plan_mismatch';
  return undefined;
}

function sameScope(left: SessionScope, right: SessionScope): boolean {
  return left.environment_digest === right.environment_digest
    && left.principal_digest === right.principal_digest
    && left.binding_digest === right.binding_digest;
}

async function withTimeout<T>(promise: Promise<T>, durationMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error('speculation duration cap exceeded')), durationMs); }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
