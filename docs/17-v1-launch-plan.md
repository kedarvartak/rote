# 17 — V1 Launch Plan: The Shortest Path to a Public Number

> Status: execution plan. V1 is the *launchable subset* of
> [16 — Harness Architecture](16-harness-architecture.md), chosen for speed: a working
> open-source browser agent whose observation and context economics visibly beat the
> incumbents, proven by a reproducible head-to-head benchmark. Everything not needed
> for that number is deferred to the phases in
> [18 — Product Roadmap](18-product-roadmap.md).

## The launch thesis

One sentence users must be able to verify in ten minutes:

> **Rote completes the same browser tasks as Browser Use at a fraction of the tokens —
> here's the harness, the benchmark, and the raw JSONL.**

V1 launches on the *deterministic* efficiency wins (perception + context layout +
accounting + verified replay). The probabilistic wins (routing, speculation, learned
site memory) are deliberately V2+ — they need calibration time and would delay the
number without changing its headline.

## In / out

| In V1 | Out (deferred, with phase) |
|---|---|
| CDP-direct local browser backend [E1] | Remote backends beyond a Browserbase connect string [E2 full — P2 phase] |
| DOM distillation + element detection + stable IDs [A1–A3] | Task-focused filtering [A5 — P2], WebMCP source [A9 — P3] |
| **Diff observations + token budgeter [A4, A8]** — the headline | Cross-step dedup [A10] |
| Cache-layout-owning context assembler [B3] | History compaction [B4], model routing [B1 — P2], prediction hints [B6] |
| Frontier-model loop, structured action output [B5, C4] | Small-model routing [B1], speculation [C3 — P3] |
| Settledness detector [C1], self-healing resolution v0 (role+name fallback chain) [C2] | Memory-ranked resolution (needs D3), batched form fill [C5 — P2] |
| Live expect checks where playbooks exist + verify gate [C6, F1] | Automated distillation [D2 — P2]; V1 replay uses hand-written playbooks (M2 style) |
| Always-on recording [D1] (built), replay fast path [B2] (built) | Subflows [D5], drift tracker [D6] |
| Per-source token + latency accounting [G1] (extends built M3) | Efficiency-regression CI [G2 — post-launch] |
| Head-to-head benchmark + published raw data [F4] | Live-site continuous eval |
| Elective vision: screenshot escape hatch only (no SoM polish) [A7 minimal] | Full SoM alignment [A7 — P2] |

Rationale for the two hardest cuts: **speculation** (C3) is the deepest differentiator
but the riskiest machinery (shadow contexts, promotion atomicity) — doc 16 gates it on
H4/H5 kill gates that shouldn't block a launch. **Routing** (B1) depends on small-model
hosting decisions (doc 16 open question 1). Both headline V2/V3 launches — a launch
cadence is worth more than one bigger launch.

## Workstreams and sequence (six weeks, one focused builder + review)

Weeks assume full-time focus; slip the calendar, not the gates.

### W1 — `packages/browser` + perception capture
- CDP backend: launch/connect/dispose, navigation, input primitives, network +
  DOM-mutation instrumentation (shared by C1/A6 later).
- Perception capture: DOM + a11y + layout + listener probing → raw capture record.
- Tests: fixture pages (the fake-world portal set, served locally) with golden
  capture snapshots.
- **Gate**: capture on the B1–B3 fixture pages is complete and deterministic.

### W2 — distill, stable IDs, diff, render
- `DistilledNode` tree + interactive-element union detection [A1/A2].
- Stable ID hashing [A3]; property tests: IDs survive attribute-only mutations,
  reordering of non-ancestral siblings.
- Tree differ [A4]; property test: `apply(base, diff) == full`.
- Budgeted renderer [A8]: full → diff → summary degradation; hard budget test.
- **Gate**: observation tokens on fixture pages ≤ Browser Use's serializer on the same
  pages (measure directly — parity or better *before* diffs; diffs are the margin).

### W3 — the loop + context assembler
- `packages/agent`: the doc 16 control loop minus speculation/routing branches
  (every step `frontier` class).
- Context assembler [B3]: stable-prefix layout, prefix-volatility tests, action-schema
  tool definitions [C4/B5] via the tagged LLM client (invariant 5).
- Recorder wired to the loop [D1]; replay fast path wired [B2].
- **Gate**: completes B1 (login→download) and B2 (multi-field form) fixture tasks
  end-to-end cold, with trajectories recorded and zero prefix-volatility test failures.

### W4 — action plane hardening
- Settledness detector [C1] with the latency-configurable fake downstream (doc 12 M6
  groundwork reused).
- Resolution fallback chain [C2]: stable-ID → role+name → text-proximity; every
  resolution outcome recorded.
- Live expect checks + verify gate wiring [C6/F1]; **sacred invariant suite extended to
  every new exit path** (CLAUDE.md invariant 1 — non-negotiable before launch).
- **Gate**: drift fixture suite (B5-style DOM mutations) — no silent wrong outcomes;
  flake rate on fixture SPAs below naive-wait baseline.

### W5 — benchmark + numbers
- `packages/bench` adapters: run Browser Use (and Stagehand-agent if time permits) on
  the same fixture tasks + a small live-site sample, same model, same task specs. Both
  harnesses read one task file, so "same task specs" is checked, not asserted in prose.
- Fairness rules from doc 03 apply to competitors: best-effort configuration, their
  defaults documented, cache-adjusted token counts, success parity reported per task,
  and competitors graded by doc 03's symmetric-verification rule — never their own
  self-report while Rote must prove it.
- G1 report: tokens (per source), latency (per phase), $ per task.
- **Gate (the launch gate, doc 16 H7 honesty rule)**: Rote wins tokens-per-task at
  success parity by a margin that survives variance. If it doesn't, we fix or we don't
  launch on efficiency claims. No number, no launch.

**Variance rule.** One agent run is noisy — a retry moves the token count — so the gate
trusts neither a single run nor a mean. Each task runs **≥15 times per harness**, and the
reduction is reported as a **seeded-bootstrap confidence range**; the gate passes only when
the range's *lower bound* clears the floor. The publishable claim is that lower bound, not
the mean: *"38% fewer tokens (95% CI: 31–44%)"*. Fewer than 15 successful runs is not a
certifiable win, by design.

> Superseded: an earlier draft of this gate said "×5 runs". At n=5 no test can be both
> rigorous and tolerant of overlap (a Mann-Whitney U at n=5 needs near-total separation),
> which forced a choice between a brittle gate and a meaningless one. More runs plus a
> conservative interval resolves it and yields a range we can publish.

### W6 — launch package
- README rewrite around the number; 90-second demo recording (doc 03's script,
  updated: side-by-side token meters); quickstart (`npx rote run "<task>"` against
  local Chrome); benchmark repo/page with raw JSONL + method.
- Docs pass: package READMEs current (CLAUDE.md docs rules), CHANGELOG release cut,
  version `0.1.0`.
- Launch surfaces: HN Show, X thread, r/LocalLLaMA + agent-builder communities;
  direct notes to infra partners (Steel/Browserbase devrel) whose backends we name.
- **Gate**: a cold reader reproduces the benchmark from the README alone.

## Launch checklist (the boring things that sink launches)

- [ ] `npx` quickstart works on a clean machine (Linux + macOS) with only an API key
- [ ] Benchmark reproduction script is one command; raw JSONL downloadable
- [ ] Every efficiency claim in the README carries a number, units, and a link to method
- [ ] Sacred invariant suite green; CI enforces changelog + lint + tests on main
- [ ] SECURITY.md / CoC / CONTRIBUTING current (exist); issue templates added
- [ ] Known-limitations section written honestly (no routing/speculation/learning yet —
      say so and link doc 18; under-promising V1 sets up the V2/V3 launch cadence)
- [ ] License check on any vendored serializer comparisons (benchmark adapters import
      competitors as dependencies, not forks)

## What V1 explicitly does not claim

No learning-over-time claims (that's V2's launch), no latency-domination claims
(speculation is V3's launch), no enterprise/fleet claims. V1's claim is narrow and
bulletproof: *the same task, fewer tokens, verified, reproducible.*

## Risks specific to V1

| Risk | Mitigation |
|---|---|
| W2 parity gate fails (our distiller worse than Browser Use's) | Their engine is documented (DeepWiki) — study, match, then diff for margin; worst case, launch slips, never fudge the gate |
| Benchmark fairness disputes post-launch | Publish adapters + configs + raw data preemptively; invite PRs correcting competitor configuration and commit to re-running |
| Live-site sample flakes in the demo | Demo on fixtures + one resilient live site; publish live-sample variance honestly |
| Scope creep toward V2 features | This doc is the contract: anything not in the "In V1" column needs a doc change first (and doc changes get reviewed) |

Next: [18 — Product Roadmap](18-product-roadmap.md)
