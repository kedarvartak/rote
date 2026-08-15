# @rote/matcher

Tier-1 **selection**: given a task, its params, and the live environment fingerprint, pick
at most one learned playbook from an append-only library — or miss. Two stages in a fixed
order (`docs/02-architecture.md` "Matcher", CLAUDE.md invariant 3): the **fingerprint hard
gate** discards every candidate proved on another environment before any semantic
comparison runs; then a **deterministic intent/param match** — every content token of the
playbook's intent must appear in the task (coverage: a task that never says "registration"
cannot select a registration procedure, however similar the rest is), the task text with the
caller's param values slotted out is scored (token Jaccard) against the templated intent,
every declared param must bind, the score must clear a conservative threshold (default 0.8),
and a distinct playbook within the ambiguity margin (0.05) makes it a miss.
v1 makes **no model call**; a future semantic stage must go through the tagged LLM client
as `matcher`. The matcher prefers misses: `docs/03-benchmark.md` T4 says any false replay
is a design kill.

## Public API

- `matchPlaybook({ task, params, envFingerprint, candidates, threshold?, ambiguityMargin? })`
  → `{ kind: 'match', entry, score, bindings, considered }` or
  `{ kind: 'no_match', reason: 'no_candidates' | 'fingerprint_mismatch' | 'params_unbound' | 'below_threshold' | 'ambiguous', best? }`.
  Pure; no I/O, no clock, no model. `base_url`/`initial_url` are never a match criterion
  (the CLI rebinds them from the live URL after the gate).
- `intentScore(task, params, playbook)` — the stage-2 score in [0, 1].
- `PlaybookLibraryEntry` — `{ playbook, fingerprint_hash, playbook_path?, source_run_id? }`:
  the environment a playbook was recorded/proved on travels with it.
- `FilePlaybookLibrary(baseDir)` — `add({ playbook, fingerprintHash, sourceRunId?, addedAt })`
  writes `playbooks/<name>-v<version>.yaml` exclusively (`PlaybookVersionExistsError` on a
  rewrite) and appends to `playbooks/library.jsonl`; `list()` reads the index (truncated
  tail skipped, never edited; complete-but-invalid line throws).

## Tests

```bash
npx vitest run packages/matcher
```

`test/invariants/matcher-fails-closed.test.ts`: record B2 through the live loop → distill →
library → match a same-shape task with new params → replay with zero model calls (T0);
near-miss tasks on the same site never match (T4); a playbook proved on another fingerprint
is discarded before scoring; versions are immutable and the index recovers from an
interrupted append.
