# 06 — Build Plan: Milestones, Tests, and Exit Gates

This is the execution companion to [05 — Roadmap](05-roadmap.md). The roadmap says *what*
phases exist; this doc says *exactly what to build, in what order, and what must pass
before moving on*. Every milestone has: goal → tasks → automated tests → manual test
script → exit gate → kill criteria (where applicable).

**Ordering principle:** build the *executor* before the *compiler*. Hand-write the first
playbooks; prove replay economics; only then automate distillation. Automating the
Distiller before the Executor is proven is building a compiler for a CPU that may not work.

**Stack assumption (override if wrong):** TypeScript, Node ≥20, Vitest for tests, Zod for
schemas — chosen because the interception surface is MCP-native and the MCP TS SDK is the
reference implementation. The trajectory/playbook formats are language-neutral
(JSONL/YAML), so a Python port later costs nothing architecturally.

**Sequencing update (2026-07):** M0–M3 below are built/authoritative. From M4 onward the
milestone sequence is superseded by [12 — Implementation Path](12-implementation-path.md)
(speculative execution, per [11 — Speculative Execution](11-speculative-execution.md));
the original M4–M7 sections are kept below because their component designs (matcher,
distiller, repair) fold into that sequence rather than disappearing.

---

## Milestone 0 — Data model & repo scaffolding (2–3 days)

The schemas are the constitution of this project; everything else conforms to them.

### Tasks
1. `packages/core/` — Zod schemas + inferred TS types for:
   - **TrajectoryEvent** — `{run_id, seq, ts, tool, args, result_digest, result_ref,
     duration_ms, error?}`. `result_digest` = first N bytes + SHA-256 + byte length;
     full results spill to content-addressed blob files.
   - **RunManifest** — `{run_id, task_spec, env_fingerprint, outcome: success|failure|
     abandoned, started_at, ended_at, token_usage[]}`.
   - **EnvFingerprint** — `{tool_inventory: sorted tool names+schema hashes,
     target_identity: domain|repo-remote|api-base, surface_versions: {}}` plus a canonical
     `fingerprint_hash`.
   - **Playbook** — the YAML spec from [02 — Architecture](02-architecture.md): metadata,
     `task_signature`, `params[]` (typed), `steps[]` (three kinds: `deterministic`,
     `slot`, `judgment`), per-step `expect` blocks, `on_fail` policy, `verify[]`,
     `version`, `confidence`.
   - **Patch** — `{playbook, base_version, step_id, replacement_step, reason,
     created_by: repair|human, run_id}`.
   - **Expect DSL v1** — closed set of assertion primitives:
     `exit_code`, `selector_visible`, `selector_absent`, `input_value`, `url_contains`,
     `text_visible`, `json_path_exists`, `json_path_equals`, `output_matches` (regex),
     `nonempty`. **No arbitrary code execution in v1.**
2. Serializers: trajectory ⇄ JSONL, playbook ⇄ YAML (comment-preserving not required v1).
3. Monorepo scaffolding: `packages/core`, `packages/recorder`, `packages/executor`,
   `packages/bench`, `packages/cli`. CI (GitHub Actions): typecheck + tests on push.
4. Fixtures directory: `fixtures/trajectories/`, `fixtures/playbooks/` — hand-authored
   golden files used by every later milestone.

### Automated tests
- **Round-trip**: every schema — parse(serialize(x)) deep-equals x; property-based
  (fast-check) for TrajectoryEvent and Playbook.
- **Rejection**: malformed playbooks fail loudly with a path to the offending field —
  unknown step kind, `{{param}}` referencing an undeclared param, duplicate step ids,
  cyclic `depends_on`, unknown expect primitive, missing `verify`.
- **Fingerprint stability**: same env described in different key order → identical
  `fingerprint_hash`; one tool schema change → different hash.
- **Digest**: result > threshold spills to blob and digest verifies; result ≤ threshold
  inlines; tampered blob fails verification.
- **Templating**: `{{param}}` substitution — nested objects, arrays, multiple occurrences,
  escaping of literal `{{`; undeclared param at *bind time* is an error, not empty string.

### Manual test
- Author `fixtures/playbooks/b1-download-report.yaml` by hand; `rote lint` (CLI stub)
  accepts it; introduce each rejection case above by hand-editing and confirm error
  messages are actually readable by a human.

### Exit gate
CI green; a colleague (or you, one week later) can read a playbook YAML cold and explain
what it does — **auditability is a design invariant, test it now**.

---

## Milestone 1 — Recorder (3–4 days)

### Tasks
1. **MCP proxy recorder**: a stdio MCP server that wraps a downstream MCP server
   (config: command + args). Forwards `tools/list` and `tools/call` verbatim; appends a
   TrajectoryEvent per call; writes RunManifest at session end.
2. Env fingerprint computed at session start from the downstream `tools/list` + a
   `target_identity` provided in config.
3. Run boundary & task spec: injected via config/env var for now (`ROTE_TASK_SPEC`);
   automatic task detection is *not* v1.
4. Token usage: recorder can't see LLM calls (it's at the tool boundary) — accept a
   sidecar usage file per run (the bench harness supplies it in M3).
5. `rote runs ls` / `rote runs show <run_id>` CLI.

### Automated tests
- **Fidelity**: fake downstream MCP server with scripted tools; N calls through proxy →
  exactly N events, seq strictly increasing, args/results byte-identical to what the
  client saw (proxy must be observationally invisible).
- **Passthrough on failure**: downstream tool error → error forwarded unchanged AND
  recorded with `error` populated.
- **Crash safety**: kill the recorder mid-run → JSONL is valid up to last full line
  (append + fsync per event); no partial-line corruption.
- **Large results**: 10 MB tool result → spilled to blob, event stays small, client
  still receives full result.
- **Concurrency**: two parallel sessions → two run files, no interleaving.
- **Overhead**: p95 added latency per call < 5 ms on the fake server (measured in CI,
  generous threshold to avoid flake).

### Manual test script
1. Point Claude Code (or any MCP client) at the recorder wrapping the browser-automation
   server.
2. Run task **B1** (log into demo portal, download report) with the plain agent.
3. `rote runs show <id>`: every navigate/fill/click/extract present, in order, with
   readable args; screenshots/DOM dumps spilled to blobs; manifest outcome = success.
4. Repeat with an intentionally failing task → outcome = failure, error captured.
5. Confirm the agent's behavior was unchanged (same task success, no visible latency).

### Exit gate
A cold B1 run through the recorder produces a trajectory a human can replay *mentally*
from the JSONL alone. If you can't follow it, the Distiller (an LLM) won't either.

---

## Milestone 2 — Replay Executor with hand-written playbooks (1–1.5 weeks)

**The thesis-critical milestone.** No Matcher, no Distiller: playbook selected by CLI flag.

### Tasks
1. Executor walks `steps[]` in dependency order:
   - `deterministic` → dispatch tool call with bound args; zero LLM.
   - `slot` → scoped LLM call (cheap model, e.g. Haiku) with only the declared context;
     result injected into args.
   - `judgment` → constrained classification call (enum output, temperature 0).
2. Evaluate `expect` after every step. v1 `on_fail` policies: `retry(n, backoff)` and
   `fallback` (abort replay, signal caller to run the plain agent). `repair` lands in M6.
3. Run `verify[]` at the end; only then report success.
4. Executor emits its own trajectory through the recorder (replays are runs too — this
   gives before/after comparability for free).
5. Hand-distill playbooks for **B1, B2, B3** from M1 trajectories. Feel this pain
   deliberately and take notes — those notes are the Distiller's spec.
6. `rote replay <playbook> --params '{...}'` CLI.

### Automated tests
Fake MCP world (scripted DOM-ish state machine) for determinism:
- **Golden replay**: 3-step playbook → exact expected tool-call sequence, zero LLM calls
  when no slots (assert via mock LLM client with call counter = 0).
- **Every expect primitive**: one pass case + one fail case each (10 primitives → 20 tests).
- **Param binding**: same playbook, different params → args differ only where templated.
- **Slot step**: mock LLM returns value → lands in the right arg; LLM returns garbage that
  fails the step's expect → policy triggers (slot output is assertion-gated too).
- **Judgment step**: output outside the declared enum → hard error, never a silent branch.
- **retry policy**: fails twice, succeeds third → success with 3 attempts recorded.
- **fallback policy**: exhausted retries → executor exits with `FALLBACK`, partial
  trajectory intact, and reports *which step* died.
- **verify failure**: all steps pass, verify fails → run reported failed. **Never report
  success on failed verify — this test is sacred.**
- **No-side-effect-repeat guard**: fallback after step k reports which steps already ran
  (the harness/human decides idempotency; the executor must never hide it).

### Manual test script
1. `rote replay b1.yaml` against the real demo portal → completes, artifact downloaded,
   compare file to cold-run artifact.
2. `rote replay b2.yaml --params <fresh form values>` → submitted form contains the new
   values exactly (check the confirmation page field by field).
3. Rename a form field in the demo portal by hand → replay fails **at that step** with
   the expect error naming the selector, then falls back. It must not click the wrong
   element and carry on.
4. Pull the network mid-replay → retry policy visibly kicks in.
5. Read the replay trajectory: tool calls ≤ 25% of the cold run's count.

### Exit gate (kill gate #1)
On B1–B3 against the real demo portal: replay success rate ≥ baseline agent, tool calls
≤ 25% of cold, wall-clock ≤ 33% of cold. **If hand-written playbooks can't hit this, no
Distiller will save the thesis — stop and rethink here.**

---

## Milestone 3 — Benchmark harness & the first number (4–5 days)

### Tasks
1. `packages/bench`: runs a matrix of `{task × phase(cold|warm) × repetition}`, drives the
   agent (cold) or executor (warm), collects trajectories + LLM usage sidecars.
2. Token accounting tagged `{run_id, phase, task, source: planner|matcher|slot|repair|
   verify}` per [03 — Benchmark](03-wedge-benchmark.md).
3. **Cache-adjusted baseline**: cold baseline reruns with warm prompt cache — report both
   raw and cache-adjusted deltas; the honest claim is vs. cache-adjusted.
4. Report generator: markdown table + raw JSONL export per run.
5. Stand up the *frozen* demo environment (pin the demo portal version / local clone) —
   benchmark numbers must be reproducible.

### Automated tests
- Accounting: synthetic usage fixtures → totals per source sum exactly; no event
  double-counted across phases.
- Determinism: same input JSONL → byte-identical report.
- Matrix integrity: a failed run marks the cell failed, never silently drops it.

### Manual test
- Full B1–B3 protocol: 3 cold + 5 warm each. Read the report end to end; spot-check two
  runs by hand-counting tokens from raw provider responses against the report.

### Exit gate (kill gate #2 — THE Phase-0 gate)
**≥ 80% token reduction warm vs cache-adjusted baseline, at success parity, on B1–B3.**
Pass → continue and put the number in the README. Fail 50–80% → one iteration on executor
overhead, then re-measure once. Fail < 50% → thesis dies; write the postmortem.

---

## Milestone 4 — Matcher (1 week)

### Tasks
1. Stage 1: `fingerprint_hash` equality (hard gate, no fuzz).
2. Stage 2: embed task spec; cosine shortlist top-k (SQLite + in-proc vectors; no vector
   DB until it hurts).
3. Stage 3: confirm-and-bind — one LLM call, structured output
   `{match: bool, confidence: 0..1, bindings: {...}}`; below τ → miss.
4. τ configurable per store; **launch default conservative (0.9)**.
5. Wire into flow: task in → match → replay | plain agent (+ record).

### Automated tests
- Fingerprint mismatch (one tool removed / target domain differs) → **never** reaches
  stage 2, regardless of semantic similarity.
- Bind extraction goldens: 10 task-phrasing variants of B2 → correct typed bindings;
  missing required param in the task text → miss (not a guessed binding).
- Type check: binding that violates param type (e.g. `amount: "abc"`) → miss.
- Threshold: confidence 0.89 with τ=0.9 → miss.
- Mock-LLM failure/timeout in stage 3 → miss (matcher must fail *open* toward
  exploration, never block the task).

### Manual test script
1. Ten natural rephrasings of B2 → expect ≥ 8 hits with correct bindings.
2. **B6 suite (false-match)**: five superficially-B2-like-but-different tasks (different
   portal, different form purpose, a *read*-only variant) → **0 replays**. Any false
   match here is a design failure, not a tuning issue: diagnose whether fingerprint,
   embedding, or confirm stage let it through.
3. Novel task → miss; measure matcher overhead tokens (report gate: ≤ 2% of a cold run).

### Exit gate
Hit rate ≥ 80% on true positives at **zero** false matches on the B6 suite.

---

## Milestone 5 — Distiller (1.5–2 weeks; the hardest milestone)

### Tasks
1. **Causal pruning** (deterministic code, not LLM): build the dependency graph — an event
   is *live* if its result content appears in a later live event's args, in the final
   answer, or is a declared side-effect step (writes: click/fill/submit/shell-mutation —
   maintain an explicit side-effect tool list per server). Everything else is pruned.
2. **LLM passes** (big model, offline, structured output):
   a. Parameterization — classify literals into task-input | env-constant | derived.
   b. Assertion synthesis — emit an `expect` (from the closed DSL) per surviving step,
      derived from what the *cold run actually observed* after that step.
   c. Slot/judgment identification — which cold-run LLM decisions were content
      (→ slot) vs branching (→ judgment, cap ≤ 2 per playbook; over cap → refuse to
      distill, mark task unmemoizable).
3. **Validation loop**: distilled playbook is *not trusted* — it must replay green against
   the live environment once (shadow validation) before entering the store as v1.
4. `rote distill <run_id>` CLI with `--dry-run` diff view.

### Automated tests
- **Pruning (pure code, exhaustive)**: synthetic trajectories with known dead ends —
  linear chain keeps all; branch-and-abandon keeps only the winning branch; a read whose
  result is never referenced is pruned; a fill/click with no referenced result is KEPT
  (side-effect rule); diamond dependencies keep both parents.
- **Distill-then-replay integration**: fixture cold trajectories (recorded from the fake
  MCP world) → distill → replay in the same fake world with new params → green. This is
  the compiler's end-to-end test; make it a CI matrix of ≥ 5 trajectory fixtures.
- **Parameterization goldens**: known task inputs lifted; env constants (base URL) NOT
  lifted; a timestamp classified as derived, not a param.
- **Cap enforcement**: trajectory needing 3 judgment gates → distiller refuses, emits
  `unmemoizable` verdict with reason.
- **Idempotence**: distilling the same run twice → semantically identical playbook
  (params may be named differently; structure and steps identical).

### Manual test script
1. Distill the real B1–B3 cold runs; **diff machine playbooks against your M2 hand-written
   ones** — this is the single most informative artifact in the whole project. Log every
   divergence: missing assertion, over-kept step, wrong param.
2. Distill B4 (judgment task) → exactly one judgment gate, sensible enum.
3. Feed it a *failed* run → refuses (only successful trajectories distill).
4. Read every generated assertion and ask: "would this catch the drift I'd expect on this
   step?" Tighten the synthesis prompt until yes.

### Exit gate
≥ 4 of 5 machine-distilled playbooks replay green on the live environment with fresh
params, with zero human edits. (The 5th may need one manual fix — record why.)

---

## Milestone 6 — Repair ladder & drift (1–1.5 weeks)

### Tasks
1. Failure classifier: transient (timeout/5xx/network) vs environmental (assertion fail on
   changed state) vs task-mismatch (bindings look wrong) — rules first, LLM assist later.
2. Scoped repair agent: context = failing step + its expect + playbook intent + current
   observed state (e.g. DOM summary) + *k* prior steps' results. Budget-capped (max
   calls + max tokens); produces a replacement step, re-executes, re-asserts.
3. Patch persistence: green repair → Patch → playbook vN+1; confidence reset for the
   patched step. Rollback: vN+1 fails its next replay → auto-revert to vN + flag.
4. Confidence & drift tracker: per-playbook `{success_streak, repair_count_30d,
   last_validated}`; matcher consults it (low confidence → shadow-validate before trust).
5. Task-mismatch classification → **no repair attempt**; straight to fallback (repairing
   a wrong match entrenches the matcher's error).

### Automated tests
- Ladder ordering: transient error → retry, no repair invoked (mock repair-LLM counter=0).
- Scoped repair (fake world): renamed selector → repair proposes new selector → replay
  completes → patch v2 exists; original v1 untouched.
- Budget: repair exceeding call/token budget → clean abort → fallback.
- Repair-produces-garbage: mock repair emits a step that fails expect → one more attempt
  (within budget) then fallback; **garbage patch is never persisted**.
- Rollback: v2 fails next replay → store serves v1 again; flag raised.
- Version history: v1..v3 all retrievable; `rote diff v1 v3` shows step-level diff.
- Mismatch → fallback directly (repair counter = 0).

### Manual test script (the B5 drift suite)
1. Mutate the demo portal: rename the submit button's selector → replay heals at that
   step, patch v2, total tokens ≤ 25% of cold.
2. Add an interstitial page (cookie banner) → repair must *insert* a step or fail
   gracefully to fallback — document which (insertion may be v2 scope; graceful fallback
   is acceptable v1 behavior, silent failure is not).
3. Change the *meaning* of a field (swap "amount" and "quantity" labels) → assertions
   must catch it; verify the run does NOT submit swapped values. **This is the
   silent-wrong-output test — the most important manual test in the project.**
4. Break 3 steps at once → expect fallback (repair is for point drift), full agent run,
   re-distill produces a fresh v-next.
5. Run the drift dashboard (`rote status`): playbook shows repair history and current
   confidence; numbers match what you just did.

### Exit gate
Drift recovery ≥ 70% on single-point mutations; repair cost ≤ 25% of cold; zero
silent-wrong-output events across the whole suite (manual check of every artifact).

---

## Milestone 7 — Full benchmark, coding vertical, publishable numbers (1 week)

### Tasks
1. Full protocol from [03](03-wedge-benchmark.md): B1–B6 + C1–C3 (coding tasks via a shell/
   git MCP server through the same recorder — this proves harness-neutrality).
2. Honest-loss sections: break-even recurrence count, drift-rate ceiling, one-shot overhead.
3. Reproducibility pack: pinned env, seeds, raw JSONL, analysis notebook, `make bench`.
4. Rewrite README headline with the measured number.

### Manual test
- A person who is not you clones the repo and reproduces the headline number from the
  pack within one hour, on their machine, without asking you anything.

### Exit gate
Reproduced-by-someone-else. Then decide: OSS release (flip repo public, Phase 2 of the
roadmap) or another private iteration.

---

## Cross-cutting rules (apply to every milestone)

- **The sacred invariant test suite** — grows monotonically, runs in CI, never skipped:
  (1) no success report on failed verify; (2) fallback always available and clean;
  (3) fingerprint mismatch never replays; (4) every store mutation is versioned.
  Any PR that touches executor/matcher/store must add or strengthen one of these.
- **Fake-world first**: every feature gets deterministic fake-MCP tests before live-portal
  manual tests. Live tests validate reality; fake tests prevent regressions.
- **Two demo environments**: `frozen` (pinned, for benchmarks) and `drifting` (you mutate
  it, for B5/M6). Never benchmark against the drifting one.
- **Every bug found manually becomes an automated test** in the same PR that fixes it.
- **Token meters on everything**: any code path that calls an LLM must tag its usage with
  a `source`; untagged usage fails CI (lint rule on the LLM client wrapper).

## Timeline summary

| # | Milestone | Duration | Kill gate? |
|---|-----------|----------|------------|
| 0 | Data model & scaffolding | 2–3 d | — |
| 1 | Recorder | 3–4 d | — |
| 2 | Executor + hand playbooks | 1–1.5 w | **Yes — replay ≤25% calls or stop** |
| 3 | Benchmark harness | 4–5 d | **Yes — ≥80% token cut or stop** |
| 4 | Matcher | 1 w | zero false matches on B6 |
| 5 | Distiller | 1.5–2 w | 4/5 auto-distilled replay green |
| 6 | Repair ladder | 1–1.5 w | ≥70% drift recovery, zero silent-wrong |
| 7 | Full benchmark + publish | 1 w | reproduced by someone else |

Total: ~8–10 weeks solo to a publishable, reproducible result — with two early exits
(end of M2, end of M3) that cost ≤ 3 weeks if the thesis is wrong.
