# Rote — design docs

> **Agent harnesses have no memory manager. Rote is the memory manager.**

Browser agents forget at three timescales and pay again at each: they re-send the
transcript every step (O(n²) within a run), re-derive the procedure every run, and re-learn
the site every task. Rote treats the context window as a managed resource — with a budget,
an eviction policy, a layout contract, and a trust gate on the way back in.

![Architecture](diagrams/architecture.svg)

## Read this first: design vs reality

These are **design docs**. Much of what they describe is planned, not built. Every doc
marks status; the authoritative table is [02 §Status](02-architecture.md).

| | |
|---|---|
| **Built** | core schemas + Expect DSL · recorder · verified replay executor · CDP backend · perception (distill → stable IDs → budget) · **observation eviction** · agent loop · tagged LLM client · benchmark + accounting + head-to-head gate |
| **Built but never exercised** | diff observations — the budget is 4000 chars and our fixtures render ~537, so it has never fired |
| **Not built** | **cache layout** (marked built until 2026-07-17; no `cache_control` is sent — [#57](https://github.com/kedarvartak/rote/issues/57)) · compaction · playbook distiller · matcher · site memory · model routing · speculation |

We are in **P1 (V1)**: **tier 0, working memory.** Neither launch gate has been run — not
the curve (cumulative tokens vs. task length) nor the level (tokens-per-task at parity).
**No number, no launch.**

## The memory spine

| Tier | Scope | The field | Us |
|---|---|---|---|
| **0 — Working** | within a run | **nobody** — everyone re-sends the transcript | **the wedge**; half-built |
| **1 — Episodic** | across runs of a task | **Skyvern ships it** | late; distiller unbuilt |
| **2 — Semantic** | across tasks on a site | nobody | unbuilt |
| **Trust gate** | all tiers | nobody — success means "no exception thrown" | invariant 1 |

## The docs

| Doc | Contents |
|---|---|
| [01 — Problem](01-problem.md) | Why agents re-derive everything; the reuse-path gap; where Rote fits and where it doesn't |
| [02 — Architecture](02-architecture.md) | **What is built vs designed**; four planes; the control loop; type spine; playbooks; repair ladder; memory tiers; speculation; invariants |
| [03 — Benchmark](03-benchmark.md) | How we measure: task suite, metrics, fairness rules, symmetric grading, the variance rule, the launch gate, generalization (T0–T5) |
| [04 — Competition](04-competition.md) | The field in four strata; per-competitor teardown; capability matrix; the steelmanned objections |
| [05 — Roadmap](05-roadmap.md) | Where we are; V1 scope and gates; P0–P5; open questions |
| [06 — Optimizations](06-optimizations.md) | The master catalog: every optimization, its tier, its status, and the evidence |
| [testing/](testing/) | Numbered records of tests against **real** Rote — live browser, live model, live key |


## Diagrams

Rendered with the Excalidraw MCP in the base hand-drawn font — no generator scripts. To
change one, re-render through the MCP and overwrite the SVG; don't hand-edit the output.

`architecture` · `package-map` · `perception-pipeline` · `run-lifecycle` · `repair-ladder`
· `vs-browser-use` · `vs-stagehand` · `vs-skyvern` · `competitive-landscape` ·
`t1-b2-false-negative`

## The invariants

Non-negotiable. Enforced in `CLAUDE.md` and the sacred invariant suites.

1. **Never silently wrong** — every replayed step is assertion-gated; no path reports
   success on a failed check.
2. **Never worse than baseline** — full-agent fallback always reachable, and it logs *why*.
3. **Never cross environments** — structural fingerprint is a hard gate.
4. **Everything versioned** — playbooks and patches are append-only, with rollback.
5. **Every model call is tagged** — through one client wrapper, or lint fails.

## A note on these docs

A stale design doc is a bug. If the implementation diverges, the doc changes in the same
PR (`CLAUDE.md` → Docs practices).

This set was consolidated on 2026-07-15 from 18 documents down to 6. The originals had
accreted in layers — a middleware-era design, a browser-memory extension, a speculation
design, then a harness redesign — each superseding the last without removing it. The
result was four overlapping build plans, three competitor docs, two roadmaps, and a
confident description of four packages that don't exist. The technical substance was
preserved; the archaeology was not. Git history has the originals.
