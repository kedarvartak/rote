import { randomUUID } from 'node:crypto';
import { TaskCheckpointSchema, type AuthoritativeEvidenceAdapter, type CheckpointEvidenceRef, type EvidenceSubject, type ParamBindings, type Playbook, type TaskCheckpoint, type VerificationEvidenceEnvelope } from '@rote/core';
import { runPlaybook, type ExecutorDeps, type ExecutorResult } from '@rote/executor';
import type { CheckpointStore } from './checkpoint-store.js';
import { assertResumable, bindingsSha256, playbookSha256, principalSha256 } from './resume-gate.js';

// see docs/05-roadmap.md P2 item 9 (#133) — continuation resumes an incomplete
// controlled workflow across browser/process restarts: load the last complete
// checkpoint, prove the session is the same environment/principal/procedure/
// inputs and that the authoritative state has not moved, then run the executor
// from the recorded position, appending a checkpoint after every completed step.

export interface ContinuationEvidence {
  adapters: readonly AuthoritativeEvidenceAdapter[];
  subject: EvidenceSubject;
  /** Current freshness generation of the source, when it exposes one (fixture reset, deploy epoch). */
  currentGeneration?: () => Promise<number>;
}

export interface ContinueTaskOptions {
  taskId: string;
  /** Caller principal (user/tenant id); only its digest is persisted. */
  principal: string;
  playbook: Playbook;
  params: ParamBindings;
  store: CheckpointStore;
  /** Executor dependencies; `resume`/`onStepCompleted` are owned by continuation. */
  executor: Omit<ExecutorDeps, 'resume' | 'onStepCompleted' | 'stopAfterStepId'>;
  evidence?: ContinuationEvidence;
  /** Controlled interruption after a step (tests, staged rollouts); the run ends `interrupted` with a checkpoint written. */
  stopAfterStepId?: string;
  /** Page the procedure expects when continuing; recorded on the checkpoint. */
  resumeUrl?: string;
  /**
   * Runs after the resume gate passes and before any step dispatches — the place
   * a caller re-establishes the browser session (open a page, navigate to
   * `checkpoint.resume_url`, restore explicit non-secret state). Skipped steps are
   * never re-run, so session setup that lived in a completed step must happen here.
   */
  prepareSession?: (context: { mode: 'fresh' | 'resumed'; checkpoint?: TaskCheckpoint }) => Promise<void>;
  clock?: () => Date;
}

/** Continuation is reported separately from replay: what was resumed and what the executor then did. */
export interface ContinuationResult {
  mode: 'fresh' | 'resumed';
  /** Sequence number of the checkpoint the session resumed from. */
  resumedFromSeq?: number;
  /** Steps skipped because an earlier session completed them. */
  resumedStepIds: string[];
  checkpointsWritten: number;
  /** The executor's own outcome for the steps this session ran. */
  replay: ExecutorResult;
}

/**
 * Resumes (or starts) a task. Throws `ContinuationMismatchError` before any action
 * when the latest checkpoint cannot be resumed here; the caller falls back cleanly.
 * Evidence adapters that throw make the checkpoint unwritable and the run stops
 * failed rather than proceeding into an unrecorded side effect.
 */
export async function continueTask(options: ContinueTaskOptions): Promise<ContinuationResult> {
  const clock = options.clock ?? (() => new Date());
  const principal = principalSha256(options.principal);
  const bindings = bindingsSha256(options.params);
  const procedure = playbookSha256(options.playbook);
  const latest = await options.store.latest(options.taskId);

  let resumeFrom: TaskCheckpoint | undefined;
  if (latest) {
    const collected = await collectEvidence(options.evidence);
    assertResumable(latest, {
      taskId: options.taskId,
      envFingerprintHash: options.executor.envFingerprint.fingerprint_hash,
      principalSha256: principal,
      playbook: options.playbook,
      bindingsSha256: bindings,
      envelopes: collected.envelopes,
      ...(collected.generation === undefined ? {} : { currentGeneration: collected.generation }),
    });
    resumeFrom = latest;
  }

  await options.prepareSession?.({ mode: resumeFrom ? 'resumed' : 'fresh', ...(resumeFrom ? { checkpoint: resumeFrom } : {}) });

  let seq = resumeFrom ? resumeFrom.seq + 1 : 0;
  let previousId = resumeFrom?.checkpoint_id;
  let written = 0;
  const writeCheckpoint = async (completedStepIds: readonly string[], stepBindings: Readonly<Record<string, string>>, status: 'in_progress' | 'completed') => {
    const collected = await collectEvidence(options.evidence);
    const checkpoint = TaskCheckpointSchema.parse({
      version: 1,
      checkpoint_id: randomUUID(),
      task_id: options.taskId,
      seq,
      ...(previousId ? { previous_checkpoint_id: previousId } : {}),
      written_at: clock().toISOString(),
      env_fingerprint_hash: options.executor.envFingerprint.fingerprint_hash,
      principal_sha256: principal,
      procedure: {
        playbook: options.playbook.playbook,
        version: options.playbook.version,
        playbook_sha256: procedure,
        completed_step_ids: [...completedStepIds],
        step_bindings: { ...stepBindings },
        status,
      },
      bindings_sha256: bindings,
      evidence_refs: evidenceRefs(collected.envelopes),
      ...(options.resumeUrl ? { resume_url: options.resumeUrl } : {}),
    });
    await options.store.append(checkpoint);
    previousId = checkpoint.checkpoint_id;
    seq += 1;
    written += 1;
  };

  const replay = await runPlaybook(options.playbook, options.params, {
    ...options.executor,
    ...(resumeFrom
      ? { resume: { completedStepIds: resumeFrom.procedure.completed_step_ids, stepBindings: resumeFrom.procedure.step_bindings } }
      : {}),
    onStepCompleted: async (event) => { await writeCheckpoint(event.completedStepIds, event.stepBindings, 'in_progress'); },
    ...(options.stopAfterStepId ? { stopAfterStepId: options.stopAfterStepId } : {}),
  });
  if (replay.outcome === 'success') {
    // The final record closes the log; a later resume attempt is `already_completed`.
    await writeCheckpoint(replay.completedStepIds, resumeFrom?.procedure.step_bindings ?? {}, 'completed');
  }
  return {
    mode: resumeFrom ? 'resumed' : 'fresh',
    ...(resumeFrom ? { resumedFromSeq: resumeFrom.seq } : {}),
    resumedStepIds: [...(resumeFrom?.procedure.completed_step_ids ?? [])],
    checkpointsWritten: written,
    replay,
  };
}

async function collectEvidence(evidence: ContinuationEvidence | undefined): Promise<{ envelopes: VerificationEvidenceEnvelope[]; generation?: number }> {
  if (!evidence) return { envelopes: [] };
  const envelopes: VerificationEvidenceEnvelope[] = [];
  for (const adapter of evidence.adapters) envelopes.push(...await adapter.collect(evidence.subject));
  const generation = evidence.currentGeneration ? await evidence.currentGeneration() : undefined;
  return { envelopes, ...(generation === undefined ? {} : { generation }) };
}

function evidenceRefs(envelopes: readonly VerificationEvidenceEnvelope[]): CheckpointEvidenceRef[] {
  return envelopes.map((envelope) => ({
    evidence_class: envelope.evidence_class,
    adapter_id: envelope.adapter_id,
    payload_sha256: envelope.payload_sha256,
    ...(envelope.freshness_generation === undefined ? {} : { freshness_generation: envelope.freshness_generation }),
  }));
}
