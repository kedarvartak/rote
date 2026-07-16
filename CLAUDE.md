# Rote — Agent Guidelines

You are working on **Rote**: **the memory manager for browser agents.** Agent harnesses
all have memory; none manages it. Rote treats the context window as a managed resource —
budget, eviction policy, layout contract, and a trust gate on the way back in — across
three tiers: **0 working** (within a run), **1 episodic** (across runs of a task),
**2 semantic** (across tasks on a site). See `docs/02-architecture.md` §The memory spine.

We are in **P1 = tier 0**. Read `docs/05-roadmap.md` for the current phase before writing
any code; do not build ahead of it (executor before distiller — never violate this).
`docs/02-architecture.md` §Status is the authoritative list of what is actually built;
much of the design is not, and some of what the docs marked built was not.

## Project invariants (non-negotiable, encode in tests, never "just this once")

1. **Never silently wrong** — no code path may report success when a `verify`/`expect`
   check failed. Any PR touching executor/matcher/store must add or strengthen a test in
   the sacred invariant suite (`packages/*/test/invariants/`).
2. **Never worse than baseline** — fallback to the plain agent must always be reachable
   and clean.
3. **Never cross environments** — fingerprint mismatch short-circuits before any fuzzy
   matching.
4. **Everything versioned** — store mutations are append-only; no in-place edits of
   playbooks or patches.
5. **Every LLM call is tagged** — all usage goes through the shared LLM client wrapper
   with a `source` tag (`planner|matcher|slot|repair|verify|distill`). Direct SDK calls
   outside the wrapper fail lint.

## Code practices

- **TypeScript strict mode**, Node ≥ 20, ESM only. Zod schemas are the single source of
  truth for types — derive with `z.infer`, never hand-duplicate an interface.
- **Monorepo layout**: `packages/core` (schemas/types, zero runtime deps beyond zod),
  `recorder`, `executor`, `bench`, `cli`. Dependency direction: everything may depend on
  `core`; `core` depends on nothing internal; `cli` may depend on all. No cycles — CI
  enforces.
- **Modularity rules**:
  - One module = one responsibility; if a file needs "and" to describe it, split it.
  - Public surface per package goes through `index.ts` exports only; deep imports across
    packages are banned (lint rule).
  - Pure logic (pruning, fingerprinting, templating, accounting) lives in dependency-free
    functions — no I/O, no clock, no env reads — so it's property-testable. Side effects
    (fs, MCP transport, LLM calls) live at the edges behind narrow interfaces.
  - Inject dependencies (clock, LLM client, blob store) as parameters; no module-level
    singletons. Tests must never monkeypatch.
- **Errors**: typed error classes with the failing step/run id attached; never swallow an
  error into a boolean. Fallback paths log *why* (classification), not just *that*.
- **No premature deps**: SQLite + in-proc vectors before a vector DB; plain fs before
  object storage. Adding a dependency requires a sentence of justification in the PR.

## Comments

- Comment **why, not what**. `// increment seq` is noise; `// seq must be assigned before
  fsync so crash recovery can detect the last complete event` is signal.
- Every exported function/type gets a JSDoc block: one-line purpose, non-obvious params,
  failure modes. Internal helpers only when non-obvious.
- Anything implementing a rule from `docs/` cites it: `// see docs/02-architecture.md
  "Matcher" — stage 1 is a hard gate`. This keeps code and design doc honest against
  each other.
- Tricky invariants get an `// INVARIANT:` comment at the enforcement site.
- No commented-out code, no `// TODO` without an issue number (`// TODO(#12): ...`).
- Match the file's existing comment density; don't blanket-comment obvious code.

## Testing

- Fake-world first: deterministic fake-MCP tests before any live-portal test.
- Every bug found manually becomes an automated test **in the same PR** that fixes it.
- Property-based tests (fast-check) for serializers, templating, fingerprinting.
- Test names state behavior, not implementation: `"reports failure when verify fails
  even if all steps passed"` not `"test verify 2"`.
- Coverage is a smell detector, not a target — but the sacred invariant suite must touch
  every executor exit path.

## Changelog (enforced by CI)

- `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com); every PR **must**
  add at least one entry under `## [Unreleased]` in the correct category
  (Added/Changed/Fixed/Removed/Security/Docs).
- Entry format: one line, imperative, user/agent-visible effect, PR number appended by
  the author: `- Recorder spills results >64KB to content-addressed blobs (#14)`.
- Exception: PRs labeled `skip-changelog` (typo fixes, CI tweaks) — use sparingly; the
  CI check looks for the label.

## Pull requests

- Use the template in `.github/PULL_REQUEST_TEMPLATE.md` — fill every section; delete
  none. "N/A" is acceptable with a reason.
- One milestone concern per PR. Do not mix a feature with an opportunistic refactor;
  split them.
- PR description must name the milestone (`M2`) and quote the exit-gate criterion the
  work advances.
- All CI checks green before requesting review. Never force-push over review comments.
- Branch names: `m<N>/<short-slug>` (e.g. `m1/recorder-crash-safety`).

## Docs practices

- `docs/01`–`06` are the design constitution. If implementation diverges from a design
  doc, **update the doc in the same PR** and note it in the changelog under `Docs`. A
  stale design doc is a bug.
- Each package gets a `README.md`: what it does (3 sentences), public API sketch, how to
  run its tests. Update it when the public surface changes — CI can't check this, so the
  PR template asks.
- Diagrams live in `docs/diagrams/` as SVG; regenerate rather than letting them rot —
  if a PR changes architecture, the diagram change belongs in that PR.
- Write for the reader who arrives cold in six months. Prefer a table to three
  paragraphs. State units (tokens, ms, bytes) on every number.

## Commit messages

- Imperative subject ≤ 72 chars; body explains why when non-obvious.
- Reference milestone and issue where applicable: `M1: fsync per event for crash safety (#8)`.
