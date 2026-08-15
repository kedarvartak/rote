# T37 — Multi-session task continuation

**Date:** 2026-08-15  
**Milestone:** P2 / E7.7 (#133)  
**Source:** issue #133; E7.1 protocol cases `E7-CONTINUATION-RESTART`, `E7-CONTINUATION-MISMATCH`

## Question

Can an incomplete controlled workflow resume across real browser/process restarts and
reach the exact authoritative outcome — with the fingerprint hard gate first, no repeated
side effect, revalidated evidence and page state before continuing, credentials and
observations kept out of the checkpoint, interrupted writes recovered without in-place
edits, and resume reported separately from zero-LLM replay?

## Contract

- **Checkpoint** (`TaskCheckpointSchema` v1, strict, `@rote/core`): `task_id`, monotonic
  `seq`, previous id, `env_fingerprint_hash`, `principal_sha256`, procedure
  `{playbook, version, playbook_sha256, completed_step_ids, step_bindings, status}`,
  `bindings_sha256`, `evidence_refs[]` (class, adapter, payload digest, generation),
  optional `resume_url`. Caller params, credentials, observations, and the raw principal
  cannot parse into it.
- **Store**: append-only per-task JSONL; `seq` must be `latest + 1`; a truncated tail
  fragment (interrupted write) is skipped and never edited; a complete-but-invalid line
  is an error.
- **Gate before any action** (`assertResumable`, fixed order): environment fingerprint →
  principal → task → procedure name/version/canonical digest → caller bindings digest →
  evidence freshness generation → evidence state digest → not already completed. Any
  failure is `ContinuationMismatchError` (`continuation_state_mismatch`, `dispatched:
  false`, typed `kind`).
- **Executor** (`@rote/executor`): `resume.completedStepIds` are skipped, never
  dispatched again; `onStepCompleted` is awaited after every completed step so the
  checkpoint is durable before the next dispatch (a failed checkpoint write ends the run
  `failure`/`CHECKPOINT_WRITE_FAILED` — no unrecorded side effect); `stopAfterStepId`
  yields the new `interrupted` outcome; `failureCode` classifies fallbacks.
- **Session setup** is the caller's (`prepareSession`): a fresh process starts blank, so
  navigation to `resume_url` happens there, not by re-running a completed step.
- **Reporting**: `ContinuationResult{mode, resumedFromSeq, resumedStepIds,
  checkpointsWritten, replay}` — resume facts separate from the executor outcome.

## Results

| Case | Result |
|---|---:|
| Real Chrome, `E7-CONTINUATION-RESTART`: 3 sessions, 2 process restarts (backend closed between) | exact 3 oracle events with frozen digests; session 2 and 3 dispatch exactly 2 steps each; resumed step ids reported |
| Real Chrome, completed procedure resumed again | `already_completed`, 0 dispatches |
| Real Chrome, `E7-CONTINUATION-MISMATCH`: fixture reset (generation bump) after checkpoint 1 | `evidence_stale`, 0 dispatches, 0 events |
| Real Chrome, different principal | `principal`, 0 dispatches |
| Fake-world: 3 sessions, per-step commit exactly once | `[1,2,3]`, log `seq 0..3`, final `completed` |
| Fingerprint / principal / procedure_version / bindings mismatch | each stops with typed kind, 0 tool calls |
| Stale generation / diverged authoritative state | `evidence_stale` / `state_diverged`, 0 tool calls |
| Checkpoint write fails (oracle unreachable) after step 1 | run `failure` `CHECKPOINT_WRITE_FAILED`, step 2 never dispatched |
| Interrupted write (truncated tail) | last complete record resumes; fragment untouched; `seq` continues 2, 3 |
| Complete-but-invalid record mid-log | read error, never skipped |
| Checkpoint contents | no param value, secret, or principal string (asserted on the serialized log) |

## What this does not claim

- No credential/profile management (P4): the caller re-supplies params on resume, and
  their digest must match.
- Live page state is revalidated through the executor's own pre-dispatch gates
  (identity resolution, contract gate) rather than a separate observation snapshot — a
  checkpoint carries no observation to compare against.
- Continuation is not learned matching: which playbook and task to resume is explicit.

## Reproduce

```bash
npm test --workspace @rote/continuation
npx vitest run packages/core/test/task-checkpoint.test.ts
npm run test:enterprise-continuation-chrome --workspace @rote/bench   # requires Chrome/Chromium
```
