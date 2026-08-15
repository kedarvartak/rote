import { z } from 'zod';
import { EvidenceClassSchema } from './verification-evidence.js';

// see docs/05-roadmap.md P2 item 9 (#133) — a task checkpoint is the append-only,
// versioned record that lets an incomplete controlled workflow resume across a
// browser/process restart. It is distinct from browser authentication state and
// from a completed-task playbook: it carries procedure position, digests that bind
// it to one environment/principal/procedure/input set, and authoritative-evidence
// references — never observations, credentials, or param values.

/** Reference to an authoritative envelope the checkpoint was written against; digests only. */
export const CheckpointEvidenceRefSchema = z.object({
  evidence_class: EvidenceClassSchema,
  adapter_id: z.string().min(1),
  payload_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  freshness_generation: z.number().int().nonnegative().optional(),
}).strict();
export type CheckpointEvidenceRef = z.infer<typeof CheckpointEvidenceRefSchema>;

/**
 * Versioned task checkpoint (strict). All binding fields are 64-hex SHA-256 digests
 * so a resume can prove "same environment, same principal, same procedure, same
 * inputs" without the checkpoint ever holding the inputs.
 */
export const TaskCheckpointSchema = z.object({
  version: z.literal(1),
  checkpoint_id: z.string().min(1),
  task_id: z.string().min(1),
  /** Monotonic per task; append-only — a resume writes seq+1, never rewrites. */
  seq: z.number().int().nonnegative(),
  previous_checkpoint_id: z.string().min(1).optional(),
  written_at: z.string().datetime(),
  /** Hard gate: `EnvFingerprint.fingerprint_hash` of the session that wrote it. */
  env_fingerprint_hash: z.string().min(1),
  /** SHA-256 of a caller-supplied principal id (user/tenant); never the id itself. */
  principal_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  procedure: z.object({
    playbook: z.string().min(1),
    version: z.number().int().positive(),
    /** SHA-256 of the canonical playbook JSON — a changed procedure cannot resume an old position. */
    playbook_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    completed_step_ids: z.array(z.string().min(1)),
    /** Step-produced bindings (slot/judgment outputs) needed to continue; never caller params. */
    step_bindings: z.record(z.string(), z.string()).default({}),
    status: z.enum(['in_progress', 'completed']),
  }).strict(),
  /** SHA-256 of canonical caller param bindings; the caller re-supplies them on resume. */
  bindings_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  evidence_refs: z.array(CheckpointEvidenceRefSchema),
  /** Where the procedure expects the browser to be when it continues (a URL is procedure, not a secret). */
  resume_url: z.string().min(1).optional(),
}).strict();
export type TaskCheckpoint = z.infer<typeof TaskCheckpointSchema>;

/** Why a checkpoint cannot be resumed; each is checked before any action. */
export const ContinuationMismatchKindSchema = z.enum([
  'fingerprint', 'principal', 'task', 'procedure_version', 'bindings', 'evidence_stale', 'state_diverged', 'already_completed',
]);
export type ContinuationMismatchKind = z.infer<typeof ContinuationMismatchKindSchema>;
