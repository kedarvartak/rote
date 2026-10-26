import { z } from 'zod';
import {
  EffectFencedFailureSchema,
  EffectFencedSpeculator,
  type EffectFencedFailure,
  type EffectFencedOutcome,
} from './effect-fenced-speculation.js';

/** Conservative, versioned defaults keep this single-step pipeline bounded. */
export const SpeculativePipelineConfigSchema = z.object({
  version: z.literal(1).default(1),
  max_depth: z.number().int().positive().default(2),
  max_concurrency: z.number().int().positive().default(1),
  confidence_threshold: z.number().min(0).max(1).default(0.95),
  max_steps: z.number().int().positive().default(8),
  max_duration_ms: z.number().int().positive().default(10_000),
}).strict();
export type SpeculativePipelineConfig = z.input<typeof SpeculativePipelineConfigSchema>;

export const SpeculativeStepSchema = z.object({
  step_id: z.string().min(1),
  depth: z.number().int().nonnegative(),
  confidence: z.number().min(0).max(1),
  depends_on: z.array(z.string().min(1)).max(8).default([]),
  request: z.unknown(),
}).strict();
export type SpeculativeStep = z.input<typeof SpeculativeStepSchema>;

export const SpeculativePipelineEventSchema = z.object({
  seq: z.number().int().nonnegative(),
  kind: z.enum(['queued', 'started', 'promoted', 'discarded', 'cancelled', 'quiesced']),
  step_id: z.string().min(1).optional(),
  reason: EffectFencedFailureSchema.or(z.enum(['cancelled', 'dependency_failed', 'budget_exhausted', 'cycle_detected', 'duration_cap'])).optional(),
}).strict();
export type SpeculativePipelineEvent = z.infer<typeof SpeculativePipelineEventSchema>;

export type SpeculativePipelineResult<Observation> = {
  promoted: string[];
  discarded: string[];
  quiesced: boolean;
  events: SpeculativePipelineEvent[];
  observations: Map<string, Observation>;
};

interface PendingStep {
  step: z.infer<typeof SpeculativeStepSchema>;
  state: 'queued' | 'running' | 'promoted' | 'discarded';
}

/**
 * Schedules a bounded set of single-step effect-fenced speculations. A miss,
 * stale receipt, failed promotion, dependency failure, cancellation, or budget
 * breach quiesces the pipeline and drains all work that has not started.
 */
export class BoundedSpeculativePipeline<Observation = unknown> {
  private readonly config: z.infer<typeof SpeculativePipelineConfigSchema>;
  private readonly steps = new Map<string, PendingStep>();
  private readonly events: SpeculativePipelineEvent[] = [];
  private nextSeq = 0;
  private cancelled = false;
  private quiesced = false;
  private running = false;

  constructor(
    private readonly speculator: EffectFencedSpeculator<Observation>,
    config: SpeculativePipelineConfig = {},
  ) {
    this.config = SpeculativePipelineConfigSchema.parse(config);
  }

  enqueue(input: unknown): { accepted: boolean; reason?: 'invalid_step' | 'duplicate' | 'budget_exhausted' | 'confidence_below_threshold' | 'depth_exceeded' } {
    if (this.running || this.quiesced || this.cancelled) return { accepted: false, reason: 'budget_exhausted' };
    const parsed = SpeculativeStepSchema.safeParse(input);
    if (!parsed.success) return { accepted: false, reason: 'invalid_step' };
    const step = parsed.data;
    if (this.steps.has(step.step_id)) return { accepted: false, reason: 'duplicate' };
    if (this.steps.size >= this.config.max_steps) return { accepted: false, reason: 'budget_exhausted' };
    if (step.confidence < this.config.confidence_threshold) return { accepted: false, reason: 'confidence_below_threshold' };
    if (step.depth > this.config.max_depth) return { accepted: false, reason: 'depth_exceeded' };
    this.steps.set(step.step_id, { step, state: 'queued' });
    this.record({ kind: 'queued', step_id: step.step_id });
    return { accepted: true };
  }

  cancel(): void {
    if (this.cancelled || this.quiesced) return;
    this.cancelled = true;
    this.record({ kind: 'cancelled' });
  }

  async run(): Promise<SpeculativePipelineResult<Observation>> {
    if (this.running) throw new Error('speculative pipeline is already running');
    this.running = true;
    const startedAt = Date.now();
    const observations = new Map<string, Observation>();
    const promoted: string[] = [];
    const discarded: string[] = [];
    const active = new Map<string, Promise<{ id: string; outcome: EffectFencedOutcome<Observation> }>>();

    while (true) {
      if (this.cancelled) this.drain(discarded, 'cancelled');
      if (Date.now() - startedAt >= this.config.max_duration_ms) {
        this.quiesce(discarded, 'duration_cap');
      }
      if (!this.quiesced && !this.cancelled) this.startReady(active, promoted, discarded);
      if (active.size === 0) {
        if (!this.quiesced && !this.cancelled && [...this.steps.values()].some((entry) => entry.state === 'queued')) this.quiesce(discarded, 'cycle_detected');
        break;
      }

      const completed = await Promise.race(active.values());
      active.delete(completed.id);
      const entry = this.steps.get(completed.id);
      if (!entry || entry.state !== 'running') continue;
      if (completed.outcome.kind === 'promoted') {
        entry.state = 'promoted';
        promoted.push(completed.id);
        observations.set(completed.id, completed.outcome.observation);
        this.record({ kind: 'promoted', step_id: completed.id });
      } else {
        entry.state = 'discarded';
        discarded.push(completed.id);
        this.quiesce(discarded, toPipelineReason(completed.outcome.failure));
      }
    }

    return { promoted, discarded, quiesced: this.quiesced || this.cancelled, events: this.events.map((event) => ({ ...event })), observations };
  }

  lifecycle(): SpeculativePipelineEvent[] {
    return this.events.map((event) => ({ ...event }));
  }

  private startReady(active: Map<string, Promise<{ id: string; outcome: EffectFencedOutcome<Observation>}>>, promoted: string[], discarded: string[]): void {
    for (const [id, entry] of this.steps) {
      if (active.size >= this.config.max_concurrency || entry.state !== 'queued') break;
      const dependencyStates = entry.step.depends_on.map((dependency) => this.steps.get(dependency)?.state);
      if (dependencyStates.some((state) => state === 'discarded')) {
        entry.state = 'discarded';
        discarded.push(id);
        this.record({ kind: 'discarded', step_id: id, reason: 'dependency_failed' });
        continue;
      }
      if (dependencyStates.some((state) => state !== 'promoted')) continue;
      entry.state = 'running';
      this.record({ kind: 'started', step_id: id });
      active.set(id, this.speculator.speculate(entry.step.request).then((outcome) => ({ id, outcome })));
    }
  }

  private quiesce(discarded: string[], reason: SpeculativePipelineEvent['reason']): void {
    if (this.quiesced) return;
    this.quiesced = true;
    this.record({ kind: 'quiesced', reason });
    this.drain(discarded, reason);
  }

  private drain(discarded: string[], reason: SpeculativePipelineEvent['reason']): void {
    for (const [id, entry] of this.steps) {
      if (entry.state !== 'queued') continue;
      entry.state = 'discarded';
      discarded.push(id);
      this.record({ kind: 'discarded', step_id: id, reason });
    }
  }

  private record(event: Omit<SpeculativePipelineEvent, 'seq'>): void {
    this.events.push(SpeculativePipelineEventSchema.parse({ seq: this.nextSeq++, ...event }));
  }
}

function toPipelineReason(failure: EffectFencedFailure): SpeculativePipelineEvent['reason'] {
  return failure;
}
