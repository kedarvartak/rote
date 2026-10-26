import { z } from 'zod';
import {
  ActionContractSchema,
  canonicalStringify,
  sha256Hex,
} from '@rote/core';

const DigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
const ContextHashSchema = z.string().length(16);
const SafeEffectClassSchema = z.enum(['pure_read', 'local_nav', 'local_write']);

/** Bindings are opaque references only; no cookies, values, URLs, or prompts enter a subflow. */
export const SubflowBindingSchema = z.object({
  environment_digest: DigestSchema,
  principal_digest: DigestSchema,
  fingerprint_digest: DigestSchema,
  document_generation: z.number().int().nonnegative(),
  context_generation: z.number().int().nonnegative(),
  verification_plan_digest: DigestSchema,
}).strict();
export type SubflowBinding = z.infer<typeof SubflowBindingSchema>;

export const SubflowStepSchema = z.object({
  action_contract: ActionContractSchema,
  action_contract_digest: DigestSchema,
  context_hash: ContextHashSchema.optional(),
  effect_class: SafeEffectClassSchema,
  verification_class: z.enum(['authoritative', 'strong']),
}).strict();
export type SubflowStep = z.infer<typeof SubflowStepSchema>;

const CandidateSubflowStepSchema = z.object({
  action_contract: ActionContractSchema,
  action_contract_digest: DigestSchema,
  context_hash: ContextHashSchema.optional(),
  effect_class: z.enum(['pure_read', 'local_nav', 'local_write', 'external_effect']),
  verification_class: z.enum(['authoritative', 'strong', 'reaction', 'judgment']),
}).strict();
type CandidateSubflowStep = z.infer<typeof CandidateSubflowStepSchema>;

/** Append-only tier-1 record for a verified common prefix. */
export const VerifiedSubflowSchema = z.object({
  version: z.literal(1),
  subflow_id: z.string().min(1),
  prefix_digest: DigestSchema,
  created_at: z.string().datetime(),
  source: z.literal('derived'),
  support_count: z.number().int().positive(),
  supporting_run_digests: z.array(DigestSchema).min(2),
  binding: SubflowBindingSchema,
  steps: z.array(SubflowStepSchema).min(1),
  handoff: z.object({
    mode: z.literal('grounded_agent'),
    next_step_index: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type VerifiedSubflow = z.infer<typeof VerifiedSubflowSchema>;

export const SubflowCandidateTrajectorySchema = z.object({
  run_digest: DigestSchema,
  task_digest: DigestSchema,
  success: z.literal(true),
  judgment_chosen: z.boolean().default(false),
  binding: SubflowBindingSchema,
  steps: z.array(CandidateSubflowStepSchema).min(1),
}).strict();
export type SubflowCandidateTrajectory = z.input<typeof SubflowCandidateTrajectorySchema>;

export const SubflowRejectionReasonSchema = z.enum([
  'invalid_candidate',
  'ambiguous',
  'judgment_chosen',
  'weak_verification',
  'effect_incompatible',
  'binding_mismatch',
  'insufficient_support',
  'contract_mismatch',
  'context_mismatch',
]);
export type SubflowRejectionReason = z.infer<typeof SubflowRejectionReasonSchema>;

export interface SubflowMiningRejection {
  run_digest?: string;
  reason: SubflowRejectionReason;
}

export interface SubflowMiningReport {
  records: VerifiedSubflow[];
  rejected: SubflowMiningRejection[];
}

/**
 * Mines only deterministic, independently verified prefixes shared by at least
 * two successful trajectories. The input contains contracts and digests, never
 * dispatched values, so the resulting record is safe to persist as tier-1 memory.
 */
export function mineVerifiedSubflows(input: readonly unknown[], options: { createdAt: Date }): SubflowMiningReport {
  const rejected: SubflowMiningRejection[] = [];
  const candidates: SubflowCandidateTrajectory[] = [];
  for (const raw of input) {
    const parsed = SubflowCandidateTrajectorySchema.safeParse(raw);
    if (!parsed.success) {
      rejected.push({ reason: 'invalid_candidate' });
      continue;
    }
    const trajectory = parsed.data;
    if (trajectory.judgment_chosen) {
      rejected.push({ run_digest: trajectory.run_digest, reason: 'judgment_chosen' });
      continue;
    }
    if (trajectory.steps.some((step) => step.verification_class !== 'authoritative' && step.verification_class !== 'strong')) {
      rejected.push({ run_digest: trajectory.run_digest, reason: 'weak_verification' });
      continue;
    }
    if (trajectory.steps.some((step) => !SafeEffectClassSchema.safeParse(step.effect_class).success)) {
      rejected.push({ run_digest: trajectory.run_digest, reason: 'effect_incompatible' });
      continue;
    }
    candidates.push(trajectory);
  }

  const groups = new Map<string, SubflowCandidateTrajectory[]>();
  for (const candidate of candidates) {
    const prefix = commonPrefix(candidate.steps);
    if (prefix.length === 0) {
      rejected.push({ run_digest: candidate.run_digest, reason: 'contract_mismatch' });
      continue;
    }
    const key = prefixKey(candidate.binding, prefix);
    groups.set(key, [...(groups.get(key) ?? []), candidate]);
  }

  const records: VerifiedSubflow[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    if (group.length < 2) {
      rejected.push(...group.map((candidate) => ({ run_digest: candidate.run_digest, reason: 'insufficient_support' as const })));
      continue;
    }
    const prefix = commonPrefixAcross(group.map((candidate) => candidate.steps));
    if (prefix.length === 0) {
      rejected.push(...group.map((candidate) => ({ run_digest: candidate.run_digest, reason: 'contract_mismatch' as const })));
      continue;
    }
    if (prefix.some((step) => step.effect_class === 'local_write' && step.verification_class !== 'authoritative')) {
      rejected.push(...group.map((candidate) => ({ run_digest: candidate.run_digest, reason: 'weak_verification' as const })));
      continue;
    }
    const supporting = group.map((candidate) => candidate.run_digest).sort();
    const prefix_digest = sha256Hex(canonicalStringify(prefix));
    const subflow = VerifiedSubflowSchema.parse({
      version: 1,
      subflow_id: `subflow:${prefix_digest.slice(0, 16)}`,
      prefix_digest,
      created_at: options.createdAt.toISOString(),
      source: 'derived',
      support_count: supporting.length,
      supporting_run_digests: supporting,
      binding: first.binding,
      steps: prefix,
      handoff: { mode: 'grounded_agent', next_step_index: prefix.length },
    });
    records.push(subflow);
  }
  return { records, rejected };
}

function commonPrefix(steps: readonly CandidateSubflowStep[]): CandidateSubflowStep[] {
  return steps.length > 0 ? [steps[0]!] : [];
}

function commonPrefixAcross(groups: readonly CandidateSubflowStep[][]): CandidateSubflowStep[] {
  const first = groups[0] ?? [];
  let length = first.length;
  for (const steps of groups.slice(1)) {
    length = Math.min(length, steps.length);
    while (length > 0 && !sameStep(steps[length - 1]!, first[length - 1]!)) length -= 1;
  }
  return first.slice(0, length);
}

function sameStep(left: CandidateSubflowStep, right: CandidateSubflowStep): boolean {
  return left.action_contract_digest === right.action_contract_digest
    && left.context_hash === right.context_hash
    && left.effect_class === right.effect_class
    && left.verification_class === right.verification_class;
}

function prefixKey(binding: SubflowBinding, prefix: readonly CandidateSubflowStep[]): string {
  return sha256Hex(canonicalStringify({
    binding,
    contracts: prefix.map((step) => ({ digest: step.action_contract_digest, context_hash: step.context_hash, effect_class: step.effect_class })),
  }));
}

export const SubflowSelectionInputSchema = z.object({
  subflow: VerifiedSubflowSchema,
  environment_digest: DigestSchema,
  principal_digest: DigestSchema,
  fingerprint_digest: DigestSchema,
  document_generation: z.number().int().nonnegative(),
  context_generation: z.number().int().nonnegative(),
  verification_plan_digest: DigestSchema,
  action_contract_digests: z.array(DigestSchema).min(1),
  context_hashes: z.array(ContextHashSchema).default([]),
}).strict();
export type SubflowSelectionInput = z.input<typeof SubflowSelectionInputSchema>;

export const SubflowSelectionReasonSchema = z.enum([
  'selected',
  'fingerprint_mismatch',
  'principal_mismatch',
  'contract_mismatch',
  'context_mismatch',
  'stale_document',
  'verification_plan_mismatch',
]);
export type SubflowSelectionReason = z.infer<typeof SubflowSelectionReasonSchema>;

export type SubflowSelection =
  | { selected: true; subflow: VerifiedSubflow; handoff: GroundedHandoff }
  | { selected: false; fallback: 'grounded_agent'; reason: Exclude<SubflowSelectionReason, 'selected'> };

/** Hard-gated selection. A failure is a clean baseline fallback and performs no subflow dispatch. */
export function selectVerifiedSubflow(input: SubflowSelectionInput): SubflowSelection {
  const parsed = SubflowSelectionInputSchema.parse(input);
  const { subflow } = parsed;
  if (subflow.binding.environment_digest !== parsed.environment_digest || subflow.binding.fingerprint_digest !== parsed.fingerprint_digest) return { selected: false, fallback: 'grounded_agent', reason: 'fingerprint_mismatch' };
  if (subflow.binding.principal_digest !== parsed.principal_digest) return { selected: false, fallback: 'grounded_agent', reason: 'principal_mismatch' };
  if (subflow.binding.document_generation !== parsed.document_generation) return { selected: false, fallback: 'grounded_agent', reason: 'stale_document' };
  if (subflow.binding.context_generation !== parsed.context_generation) return { selected: false, fallback: 'grounded_agent', reason: 'context_mismatch' };
  if (subflow.binding.verification_plan_digest !== parsed.verification_plan_digest) return { selected: false, fallback: 'grounded_agent', reason: 'verification_plan_mismatch' };
  const contracts = subflow.steps.map((step) => step.action_contract_digest);
  if (parsed.action_contract_digests.length < contracts.length || contracts.some((digest, index) => parsed.action_contract_digests[index] !== digest)) return { selected: false, fallback: 'grounded_agent', reason: 'contract_mismatch' };
  const contexts = subflow.steps.map((step) => step.context_hash).filter((value): value is string => value !== undefined);
  if (contexts.some((context, index) => parsed.context_hashes[index] !== context)) return { selected: false, fallback: 'grounded_agent', reason: 'context_mismatch' };
  return { selected: true, subflow, handoff: createGroundedHandoff(subflow, subflow.steps.length) };
}

export const GroundedHandoffSchema = z.object({
  mode: z.literal('grounded_agent'),
  completed_prefix_length: z.number().int().nonnegative(),
  next_step_index: z.number().int().nonnegative(),
  fallback: z.literal('grounded_agent'),
}).strict();
export type GroundedHandoff = z.infer<typeof GroundedHandoffSchema>;

/** The subflow owns only its verified prefix; the normal grounded agent resumes here. */
export function createGroundedHandoff(subflow: VerifiedSubflow, completedPrefixLength: number): GroundedHandoff {
  const bounded = Math.max(0, Math.min(completedPrefixLength, subflow.steps.length));
  return GroundedHandoffSchema.parse({ mode: 'grounded_agent', completed_prefix_length: bounded, next_step_index: bounded, fallback: 'grounded_agent' });
}

export interface SubflowStore {
  read(): Promise<VerifiedSubflow[]>;
  append(records: readonly VerifiedSubflow[]): Promise<void>;
}

/** In-memory append-only store used by callers and tests; no update/delete operation exists. */
export class MemorySubflowStore implements SubflowStore {
  private records: VerifiedSubflow[] = [];

  async read(): Promise<VerifiedSubflow[]> {
    return this.records.map((record) => VerifiedSubflowSchema.parse(record));
  }

  async append(records: readonly VerifiedSubflow[]): Promise<void> {
    const parsed = records.map((record) => VerifiedSubflowSchema.parse(record));
    this.records = [...this.records, ...parsed];
  }
}
