# T15 — Failed replay returns to the plain agent

## Finding and fix

The manually selected exact-fingerprint path returned a failed replay result directly to
the CLI. Fingerprint mismatch already reached the cold planner, but an action/assertion
failure or thrown replay error could strand the task. That violated invariant 2 even
though it did not report false success.

The CLI integration now retains `replay_failed` or `replay_error` plus its detail,
re-navigates from the pinned initial URL through the ordinary cold path, and prints the
classification whether cold fallback succeeds or fails. Both exits are covered in
`packages/cli/test/invariants/never-worse-than-baseline.test.ts`.

## Packaged live probe

A fresh `@rote/cli@0.1.0` tarball was installed outside the monorepo. An exact-fingerprint
B1 candidate used the normal playbook with its first post-navigation assertion changed
from `#login-form` to absent `#never-present`. Replay failed before any server-side
mutation. The installed CLI then restarted the OpenAI `gpt-4.1-mini` cold agent:

```text
success: task verification passed
phase: cold
fallback: replay_failed (selector "#never-present" not visible)
steps: 5
tokens: 2661 input + 186 output
```

The evidence retains both attempts: one failed replay manifest and one independently
verified cold success manifest. A failed cheap path is not rewritten into a warm success.

- [CLI output](data/T15-replay-fallback-output.txt)
- [Both manifests](data/T15-replay-fallback-manifests.json)
- [Both trajectories and cold provider receipts](data/T15-replay-fallback-trajectories.jsonl)
- [`npm pack` metadata](data/T15-replay-fallback-pack.json)

## Remaining limit

Re-navigation resets browser document state, not arbitrary server-side mutations. Rote
cannot generically undo a destructive action completed before a later replay assertion
fails. Replay remains safe only where authored assertions stop before unsafe continuation
and the task/site has retry-safe or explicit reset semantics. Transactional compensation
is not built and this result does not claim otherwise.
