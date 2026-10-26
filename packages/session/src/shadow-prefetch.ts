import { z } from 'zod';
import {
  SpeculationInputSchema,
  classifySpeculation,
  maySpeculate,
  type ActionContract,
  type SpeculationInput,
} from '@rote/action';
import { SessionScopeSchema, type SessionScope } from './session-scope.js';

/** Versioned source tags keep model-derived telemetry attributable without retaining prompts or observations. */
export const PrefetchSourceSchema = z.enum(['model', 'heuristic', 'replay']);
export type PrefetchSource = z.infer<typeof PrefetchSourceSchema>;

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);

/** Only the action contract and opaque freshness bindings enter the prefetch path. */
export const ShadowPrefetchRequestSchema = z.object({
  session_id: z.string().min(1),
  scope: SessionScopeSchema,
  shadow_epoch: z.number().int().nonnegative(),
  document_generation: z.number().int().nonnegative(),
  context_generation: z.number().int().nonnegative(),
  prediction_digest: DigestSchema,
  source: PrefetchSourceSchema,
  action: SpeculationInputSchema,
}).strict();
export type ShadowPrefetchRequest = z.input<typeof ShadowPrefetchRequestSchema>;

/** Adapter output is intentionally value-free: a digest is enough to compare an observation. */
export const ShadowObservationSchema = z.object({
  observation_digest: DigestSchema,
  scope: SessionScopeSchema,
  shadow_epoch: z.number().int().nonnegative(),
  document_generation: z.number().int().nonnegative(),
  context_generation: z.number().int().nonnegative(),
}).strict();
export type ShadowObservation = z.infer<typeof ShadowObservationSchema>;

export interface ShadowPrefetchExecutor<Observation = unknown> {
  /** This is the only dispatch hook, and it is called after the pure-read gate passes. */
  dispatchPureRead(input: { session_id: string; action: ActionContract }): Promise<{ observation: Observation; receipt: ShadowObservation }>;
}

export const PrefetchTelemetryKindSchema = z.enum(['hit', 'miss', 'discard']);
export type PrefetchTelemetryKind = z.infer<typeof PrefetchTelemetryKindSchema>;
export const PrefetchDiscardReasonSchema = z.enum([
  'invalid_request',
  'effect_boundary',
  'stale_context',
  'scope_mismatch',
  'digest_mismatch',
  'dispatch_failed',
]);
export type PrefetchDiscardReason = z.infer<typeof PrefetchDiscardReasonSchema>;

/** Append-only, value-free telemetry. It carries no prompt, target name, URL, or observation. */
export const PrefetchTelemetrySchema = z.object({
  seq: z.number().int().nonnegative(),
  kind: PrefetchTelemetryKindSchema,
  source: PrefetchSourceSchema,
  session_id: z.string().min(1),
  action_class: z.literal('pure_read').optional(),
  reason: PrefetchDiscardReasonSchema.optional(),
}).strict();
export type PrefetchTelemetry = z.infer<typeof PrefetchTelemetrySchema>;

export type ShadowPrefetchOutcome =
  | { kind: 'hit'; observation: unknown }
  | { kind: 'miss' }
  | { kind: 'discard'; reason: PrefetchDiscardReason };

/**
 * Runs only predicted pure-read observations. The executor is deliberately
 * narrower than a browser dispatcher, so this coordinator cannot dispatch a
 * mutation or turn a shadow observation into verification evidence.
 */
export class ShadowPrefetchCoordinator<Observation = unknown> {
  private readonly telemetryEvents: PrefetchTelemetry[] = [];
  private nextSeq = 0;

  constructor(private readonly executor: ShadowPrefetchExecutor<Observation>) {}

  async prefetch(input: unknown): Promise<ShadowPrefetchOutcome> {
    const parsed = ShadowPrefetchRequestSchema.safeParse(input);
    if (!parsed.success) {
      this.record({ kind: 'discard', source: this.sourceOf(input), session_id: this.sessionOf(input), reason: 'invalid_request' });
      return { kind: 'discard', reason: 'invalid_request' };
    }

    const request = parsed.data;
    const verdict = classifySpeculation(request.action);
    if (!maySpeculate(verdict)) {
      this.record({ kind: 'discard', source: request.source, session_id: request.session_id, reason: 'effect_boundary' });
      return { kind: 'discard', reason: 'effect_boundary' };
    }

    let result: { observation: Observation; receipt: ShadowObservation };
    try {
      // No code path reaches the executor until the closed action schema and
      // the pure-read classifier have both accepted the request.
      result = await this.executor.dispatchPureRead({ session_id: request.session_id, action: request.action.contract });
    } catch {
      this.record({ kind: 'discard', source: request.source, session_id: request.session_id, reason: 'dispatch_failed' });
      return { kind: 'discard', reason: 'dispatch_failed' };
    }

    const receipt = ShadowObservationSchema.safeParse(result.receipt);
    if (!receipt.success) {
      this.record({ kind: 'discard', source: request.source, session_id: request.session_id, reason: 'stale_context' });
      return { kind: 'discard', reason: 'stale_context' };
    }
    if (!sameBinding(request, receipt.data)) {
      this.record({ kind: 'discard', source: request.source, session_id: request.session_id, reason: 'scope_mismatch' });
      return { kind: 'discard', reason: 'scope_mismatch' };
    }
    if (receipt.data.observation_digest !== request.prediction_digest) {
      this.record({ kind: 'miss', source: request.source, session_id: request.session_id });
      return { kind: 'miss' };
    }

    this.record({ kind: 'hit', source: request.source, session_id: request.session_id, action_class: 'pure_read' });
    return { kind: 'hit', observation: result.observation };
  }

  telemetry(): PrefetchTelemetry[] {
    return this.telemetryEvents.map((event) => ({ ...event }));
  }

  private record(event: Omit<PrefetchTelemetry, 'seq'>): void {
    this.telemetryEvents.push(PrefetchTelemetrySchema.parse({ seq: this.nextSeq++, ...event }));
  }

  private sourceOf(input: unknown): PrefetchSource {
    if (typeof input !== 'object' || input === null || !('source' in input)) return 'heuristic';
    const source = PrefetchSourceSchema.safeParse(input.source);
    return source.success ? source.data : 'heuristic';
  }

  private sessionOf(input: unknown): string {
    if (typeof input !== 'object' || input === null || !('session_id' in input) || typeof input.session_id !== 'string') return 'unknown';
    return input.session_id.slice(0, 128) || 'unknown';
  }
}

function sameBinding(request: z.infer<typeof ShadowPrefetchRequestSchema>, receipt: ShadowObservation): boolean {
  return request.shadow_epoch === receipt.shadow_epoch
    && request.document_generation === receipt.document_generation
    && request.context_generation === receipt.context_generation
    && sameScope(request.scope, receipt.scope);
}

function sameScope(left: SessionScope, right: SessionScope): boolean {
  return left.environment_digest === right.environment_digest
    && left.principal_digest === right.principal_digest
    && left.binding_digest === right.binding_digest;
}

/** Compile-time anchor: the request remains a strict action input, never a raw browser command. */
export type { SpeculationInput };
