import { sha256Hex, stableStringify, type ContinuationMismatchKind, type Playbook, type TaskCheckpoint, type VerificationEvidenceEnvelope } from '@rote/core';

// see docs/05-roadmap.md P2 item 9 (#133) — every check below runs before any
// action. A checkpoint that fails any of them is not resumed; the caller gets a
// typed, classified failure and falls back cleanly (fresh cold run or nothing).

/** Raised before dispatch when a checkpoint cannot be resumed in the current session. */
export class ContinuationMismatchError extends Error {
  readonly classification = 'continuation_state_mismatch' as const;
  readonly dispatched = false as const;
  constructor(readonly kind: ContinuationMismatchKind, readonly taskId: string, detail: string) {
    super(`continuation_state_mismatch (${kind}) for task ${taskId}: ${detail}`);
    this.name = 'ContinuationMismatchError';
  }
}

/** What the resuming session can prove about itself; compared against the checkpoint's digests. */
export interface ResumeContext {
  taskId: string;
  envFingerprintHash: string;
  principalSha256: string;
  playbook: Playbook;
  bindingsSha256: string;
  /** Freshly collected authoritative envelopes (may be empty when the task has no adapters). */
  envelopes: readonly VerificationEvidenceEnvelope[];
  /** Current freshness generation of the authoritative source, when it exposes one. */
  currentGeneration?: number;
}

/** SHA-256 of the canonical playbook JSON — the procedure identity a checkpoint binds to. */
export function playbookSha256(playbook: Playbook): string {
  return sha256Hex(stableStringify(playbook));
}

/** SHA-256 of canonical caller bindings; values never leave this function. */
export function bindingsSha256(bindings: Readonly<Record<string, unknown>>): string {
  return sha256Hex(stableStringify(bindings));
}

/** SHA-256 of a caller principal id (user/tenant); the id itself is never persisted. */
export function principalSha256(principal: string): string {
  return sha256Hex(`principal ${principal}`);
}

/**
 * Pure gate: throws `ContinuationMismatchError` on the first failing check, in a
 * fixed order (environment → principal → task → procedure → bindings → evidence
 * freshness → evidence state → completion). Returns nothing on success.
 */
export function assertResumable(checkpoint: TaskCheckpoint, context: ResumeContext): void {
  if (checkpoint.env_fingerprint_hash !== context.envFingerprintHash) {
    // INVARIANT: never cross environments — the fingerprint gate precedes everything else.
    throw new ContinuationMismatchError('fingerprint', context.taskId, 'environment fingerprint differs from the checkpoint');
  }
  if (checkpoint.principal_sha256 !== context.principalSha256) {
    throw new ContinuationMismatchError('principal', context.taskId, 'principal differs from the checkpoint');
  }
  if (checkpoint.task_id !== context.taskId) {
    throw new ContinuationMismatchError('task', context.taskId, `checkpoint belongs to task ${checkpoint.task_id}`);
  }
  const procedure = playbookSha256(context.playbook);
  if (checkpoint.procedure.playbook !== context.playbook.playbook || checkpoint.procedure.version !== context.playbook.version || checkpoint.procedure.playbook_sha256 !== procedure) {
    throw new ContinuationMismatchError('procedure_version', context.taskId, `checkpoint was written for ${checkpoint.procedure.playbook}@${checkpoint.procedure.version} (${checkpoint.procedure.playbook_sha256.slice(0, 12)}), current is ${context.playbook.playbook}@${context.playbook.version} (${procedure.slice(0, 12)})`);
  }
  if (checkpoint.bindings_sha256 !== context.bindingsSha256) {
    throw new ContinuationMismatchError('bindings', context.taskId, 'caller bindings differ from the checkpoint (digest mismatch)');
  }
  for (const ref of checkpoint.evidence_refs) {
    if (context.currentGeneration !== undefined && ref.freshness_generation !== undefined && ref.freshness_generation !== context.currentGeneration) {
      throw new ContinuationMismatchError('evidence_stale', context.taskId, `authoritative source generation is ${context.currentGeneration}, checkpoint evidence was generation ${ref.freshness_generation}`);
    }
    const match = context.envelopes.find((envelope) => envelope.adapter_id === ref.adapter_id && envelope.evidence_class === ref.evidence_class);
    if (!match || match.payload_sha256 !== ref.payload_sha256) {
      // The authoritative state moved (or vanished) between sessions: someone else
      // acted, or the fixture was mutated. Continuing would act on a stale belief.
      throw new ContinuationMismatchError('state_diverged', context.taskId, `authoritative state for ${ref.adapter_id} no longer matches the checkpoint`);
    }
  }
  if (checkpoint.procedure.status === 'completed') {
    throw new ContinuationMismatchError('already_completed', context.taskId, 'the checkpointed procedure already completed; nothing to resume');
  }
}
