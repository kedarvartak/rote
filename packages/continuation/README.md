# @rote/continuation

Multi-session task continuation (P2 item 9, #133): append-only, versioned task
checkpoints and a gated resume so an incomplete controlled workflow can continue across
a browser/process restart. A checkpoint is neither browser authentication state nor a
completed-task playbook — it is procedure position plus digests that bind it to one
environment, principal, procedure, and input set, plus authoritative-evidence references.

## Public API

- `continueTask(options)` — loads the task's last complete checkpoint; if one exists,
  collects authoritative evidence and runs the resume gate; calls `prepareSession`
  (caller re-opens/navigates the browser — skipped steps are never re-run); runs the
  executor with `resume: {completedStepIds, stepBindings}` and appends a checkpoint after
  every completed step (before the next dispatch); appends a final `completed` record on
  success. Returns `ContinuationResult` — `mode: 'fresh' | 'resumed'`, `resumedFromSeq`,
  `resumedStepIds`, `checkpointsWritten`, and the executor's `replay` result **reported
  separately**. Throws `ContinuationMismatchError` (`classification:
  'continuation_state_mismatch'`, `dispatched: false`, `kind`) before any action.
- `assertResumable(checkpoint, context)` — pure gate in fixed order: environment
  fingerprint → principal → task → procedure (name/version/canonical digest) → caller
  bindings digest → evidence freshness generation → evidence state digest → not already
  completed.
- `FileCheckpointStore` / `MemoryCheckpointStore` — append-only per-task JSONL
  (`<baseDir>/continuations/<task>/checkpoints.jsonl`); `seq` must be exactly `latest+1`;
  a truncated tail fragment from an interrupted write is skipped (the previous complete
  record stays authoritative, the fragment is never edited), while a complete-but-invalid
  line is an error.
- `playbookSha256` / `bindingsSha256` / `principalSha256` — the digests a checkpoint
  binds to; values never leave these functions.

Credentials, params, observations, and the raw principal never enter a checkpoint (strict
schema in `@rote/core`: `TaskCheckpointSchema`). Production credential/profile management
stays P4.

## Running tests

```bash
npm test --workspace @rote/continuation
npm run test:enterprise-continuation-chrome --workspace @rote/bench   # E7-CONTINUATION-* in real Chrome
```
