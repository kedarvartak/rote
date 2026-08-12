import { z } from 'zod';
import { sha256Hex } from '../fingerprint.js';

// see docs/02-architecture.md "Enterprise browser contracts" — step 4 (#130):
// verification evidence is versioned, provenance-stamped, freshness-bound, and
// subject-bound. UI state remains supporting evidence; it can never satisfy an
// authoritative requirement.

/**
 * Every evidence source the verifier recognizes. The split matters: `ui_*`
 * classes describe what the harness saw on screen, the rest describe state an
 * independent system of record attests to.
 */
export const EvidenceClassSchema = z.enum([
  'ui_text',
  'ui_url',
  'api_state',
  'database_state',
  'fixture_oracle',
  'browser_download_event',
]);
/** Evidence source category; see {@link AUTHORITATIVE_EVIDENCE_CLASSES} for the trust split. */
export type EvidenceClass = z.infer<typeof EvidenceClassSchema>;

/**
 * Classes an evidence policy may *require*. UI classes are deliberately absent:
 * a task that declares an authoritative outcome cannot be satisfied by what the
 * page happened to display (docs/02 — prohibited success signals).
 */
export const AUTHORITATIVE_EVIDENCE_CLASSES = [
  'api_state',
  'database_state',
  'fixture_oracle',
  'browser_download_event',
] as const;

const AuthoritativeEvidenceClassSchema = z.enum(AUTHORITATIVE_EVIDENCE_CLASSES);
/** Evidence class that may appear in a policy requirement. */
export type AuthoritativeEvidenceClass = z.infer<typeof AuthoritativeEvidenceClassSchema>;

/** True when envelopes of this class may satisfy a policy requirement. */
export function isAuthoritativeEvidenceClass(evidenceClass: EvidenceClass): evidenceClass is AuthoritativeEvidenceClass {
  return (AUTHORITATIVE_EVIDENCE_CLASSES as readonly string[]).includes(evidenceClass);
}

const Sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/);

/** Task/run pair an evidence record attests about — evidence for another subject never transfers. */
export const EvidenceSubjectSchema = z.object({
  task_id: z.string().min(1),
  run_id: z.string().min(1),
}).strict();
/** Task/run binding for evidence collection and evaluation. */
export type EvidenceSubject = z.infer<typeof EvidenceSubjectSchema>;

/**
 * One versioned, redacted evidence record.
 *
 * INVARIANT: the envelope carries a payload *digest*, never the payload — and
 * `.strict()` makes that structural: an adapter that tries to attach `payload`,
 * `value`, or any credential field fails schema parse instead of leaking it
 * into manifests (#130 "no credential or duplicated sensitive dispatched value").
 */
export const VerificationEvidenceEnvelopeSchema = z.object({
  schema_version: z.literal(1),
  evidence_class: EvidenceClassSchema,
  /** Which injected adapter produced this record. */
  adapter_id: z.string().min(1),
  /** Provenance descriptor (endpoint, origin, store name) — never payload content. */
  source: z.string().min(1),
  subject: EvidenceSubjectSchema,
  /** Injected-clock collection time; policies may bound age from it. */
  collected_at_ms: z.number().int().nonnegative(),
  /** Monotonic source generation (e.g. fixture reset epoch), when the source has one. */
  freshness_generation: z.number().int().nonnegative().optional(),
  payload_sha256: Sha256HexSchema,
  payload_byte_length: z.number().int().nonnegative(),
}).strict();
/** Versioned redacted evidence record. */
export type VerificationEvidenceEnvelope = z.infer<typeof VerificationEvidenceEnvelopeSchema>;

/** One authoritative class a task demands, optionally pinned to an exact payload digest. */
export const EvidenceRequirementSchema = z.object({
  evidence_class: AuthoritativeEvidenceClassSchema,
  /** When present, only evidence with exactly this digest is consistent. */
  expected_payload_sha256: Sha256HexSchema.optional(),
}).strict();
/** One required authoritative evidence class. */
export type EvidenceRequirement = z.infer<typeof EvidenceRequirementSchema>;

/**
 * Task-declared evidence policy. An empty `required` list keeps today's
 * UI-supported verification behavior; a non-empty list makes the named
 * authoritative classes mandatory for success.
 */
export const EvidencePolicySchema = z.object({
  schema_version: z.literal(1),
  required: z.array(EvidenceRequirementSchema),
  /** Maximum acceptable age of an envelope relative to evaluation time. */
  max_age_ms: z.number().int().positive().optional(),
}).strict();
/** Task-declared required-evidence policy. */
export type EvidencePolicy = z.infer<typeof EvidencePolicySchema>;

/** Typed reason an evidence policy was not satisfied; names align with the E7.1 corpus oracles. */
export const EvidencePolicyFailureClassificationSchema = z.enum([
  'authoritative_effect_missing',
  'authoritative_evidence_task_mismatch',
  'authoritative_evidence_stale',
  'authoritative_evidence_inconsistent',
]);
/** Typed evidence-gate failure reason. */
export type EvidencePolicyFailureClassification = z.infer<typeof EvidencePolicyFailureClassificationSchema>;

/** Evaluation-time facts the evaluator compares envelopes against. */
export interface EvidenceEvaluationBinding {
  subject: EvidenceSubject;
  /** Injected evaluation clock, same epoch as `collected_at_ms`. */
  now_ms: number;
  /**
   * The source's current generation, when the caller can observe one. When set,
   * an envelope must carry the identical generation to count as fresh — an
   * envelope without a generation is stale by construction under a
   * generation-bound evaluation.
   */
  current_generation?: number;
}

/** Outcome of evaluating a policy over collected evidence. */
export type EvidencePolicyVerdict =
  | { satisfied: true; consumed: readonly VerificationEvidenceEnvelope[] }
  | { satisfied: false; classification: EvidencePolicyFailureClassification; detail: string };

/**
 * Decides whether collected evidence satisfies a task's policy. Pure — no I/O,
 * no clock reads; callers inject `now_ms` and the current generation.
 *
 * Per requirement, in policy order, the first failing gate classifies the
 * verdict: no envelope of the class at all → `authoritative_effect_missing`;
 * envelopes exist only for another task/run → `..._task_mismatch`; subject-bound
 * envelopes are all aged/generation-shifted → `..._stale`; fresh envelopes all
 * miss a pinned digest → `..._inconsistent`.
 *
 * INVARIANT: a requirement is only ever matched by envelopes of its own
 * authoritative class, so UI evidence — or any volume of unrelated evidence —
 * can never satisfy an authoritative requirement (sacred invariant #1).
 */
export function evaluateEvidencePolicy(
  policy: EvidencePolicy,
  envelopes: readonly VerificationEvidenceEnvelope[],
  binding: EvidenceEvaluationBinding,
): EvidencePolicyVerdict {
  const consumed: VerificationEvidenceEnvelope[] = [];
  for (const requirement of policy.required) {
    const ofClass = envelopes.filter((envelope) => envelope.evidence_class === requirement.evidence_class);
    if (ofClass.length === 0) {
      return {
        satisfied: false,
        classification: 'authoritative_effect_missing',
        detail: `no ${requirement.evidence_class} evidence was collected for task "${binding.subject.task_id}"`,
      };
    }
    const bound = ofClass.filter((envelope) =>
      envelope.subject.task_id === binding.subject.task_id && envelope.subject.run_id === binding.subject.run_id);
    if (bound.length === 0) {
      return {
        satisfied: false,
        classification: 'authoritative_evidence_task_mismatch',
        detail: `${requirement.evidence_class} evidence exists only for another task/run, not "${binding.subject.task_id}"/"${binding.subject.run_id}"`,
      };
    }
    const fresh = bound.filter((envelope) => isFresh(envelope, policy, binding));
    if (fresh.length === 0) {
      return {
        satisfied: false,
        classification: 'authoritative_evidence_stale',
        detail: `${requirement.evidence_class} evidence for task "${binding.subject.task_id}" is stale under `
          + describeFreshnessRule(policy, binding),
      };
    }
    const consistent = requirement.expected_payload_sha256 === undefined
      ? fresh
      : fresh.filter((envelope) => envelope.payload_sha256 === requirement.expected_payload_sha256);
    if (consistent.length === 0) {
      return {
        satisfied: false,
        classification: 'authoritative_evidence_inconsistent',
        detail: `${requirement.evidence_class} evidence digest does not match the expected ${requirement.expected_payload_sha256}`,
      };
    }
    consumed.push(consistent[0]!);
  }
  return { satisfied: true, consumed };
}

function isFresh(
  envelope: VerificationEvidenceEnvelope,
  policy: EvidencePolicy,
  binding: EvidenceEvaluationBinding,
): boolean {
  if (policy.max_age_ms !== undefined && binding.now_ms - envelope.collected_at_ms > policy.max_age_ms) return false;
  if (binding.current_generation !== undefined && envelope.freshness_generation !== binding.current_generation) return false;
  return true;
}

function describeFreshnessRule(policy: EvidencePolicy, binding: EvidenceEvaluationBinding): string {
  const rules: string[] = [];
  if (policy.max_age_ms !== undefined) rules.push(`max_age_ms=${policy.max_age_ms}`);
  if (binding.current_generation !== undefined) rules.push(`current_generation=${binding.current_generation}`);
  return rules.length > 0 ? rules.join(', ') : 'no freshness rule';
}

/**
 * Narrow injected interface an authoritative evidence source implements. The
 * adapter owns the side effect (HTTP fetch, database read, download listing);
 * everything it returns is already redacted to envelope form. Collection
 * failures must throw — never return an empty list to mask an unreachable
 * source, because "no effect recorded" and "could not check" are different
 * verdicts (CLAUDE.md — never swallow an error into a boolean).
 */
export interface AuthoritativeEvidenceAdapter {
  readonly id: string;
  collect(subject: EvidenceSubject): Promise<readonly VerificationEvidenceEnvelope[]>;
}

/** Redacted digest of an evidence payload; the payload itself is never stored. */
export interface EvidencePayloadDigest {
  sha256: string;
  byte_length: number;
}

/**
 * Digests an evidence payload over a canonical (deep key-sorted) JSON encoding,
 * so semantically identical payloads compare equal regardless of key order.
 * Policies pin `expected_payload_sha256` by digesting the expected payload with
 * this same function.
 */
export function digestEvidencePayload(payload: unknown): EvidencePayloadDigest {
  const canonical = stableStringify(payload);
  return { sha256: sha256Hex(canonical), byte_length: Buffer.byteLength(canonical, 'utf8') };
}

/**
 * Builds a validated envelope from a raw payload, digesting and discarding the
 * payload in one step so adapters never hold a struct that could serialize it.
 */
export function buildEvidenceEnvelope(input: {
  evidence_class: EvidenceClass;
  adapter_id: string;
  source: string;
  subject: EvidenceSubject;
  collected_at_ms: number;
  freshness_generation?: number;
  payload: unknown;
}): VerificationEvidenceEnvelope {
  const digest = digestEvidencePayload(input.payload);
  return VerificationEvidenceEnvelopeSchema.parse({
    schema_version: 1,
    evidence_class: input.evidence_class,
    adapter_id: input.adapter_id,
    source: input.source,
    subject: input.subject,
    collected_at_ms: input.collected_at_ms,
    ...(input.freshness_generation === undefined ? {} : { freshness_generation: input.freshness_generation }),
    payload_sha256: digest.sha256,
    payload_byte_length: digest.byte_length,
  });
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((entry) => stableStringify(entry)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`);
  return `{${entries.join(',')}}`;
}
