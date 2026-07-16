# Rote — design docs

> **The browser agent that gets cheaper as it learns a site.**

Rote is a browser-agent harness built around efficiency: compact observations, stable
element IDs, diff-based perception, cache-friendly context, verified replay, and a
learning plane that turns prior runs into site memory.

![Architecture](diagrams/architecture.svg)

## Read this first: design vs reality

These are **design docs**. Much of what they describe is planned, not built. Every doc
marks status; the authoritative table is [02 §Status](02-architecture.md).

| | |
|---|---|
| **Built** | core schemas + Expect DSL · recorder · verified replay executor · CDP backend · perception (distill → stable IDs → diff → budget) · agent loop · context assembler · tagged LLM client · benchmark + accounting + head-to-head gate |
| **Not built** | playbook distiller (V1 replays hand-written playbooks) · matcher · site memory · model routing · speculation |
| **Known broken** | the live-agent `expect` design — [T1](testing/T1-openai-dry-run.md), [#49](https://github.com/kedarvartak/rote/issues/49) |

We are in **P1 (V1)**. The launch gate — a measured tokens-per-task win at success parity
— **has not been run yet**, and is blocked on #49. No number, no launch.

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

### Working notes (not constitution)

| Note | Contents |
|---|---|
| [Browser memory moat](browser-memory-moat.md) | Agent loops are O(n²) in task length and the field only optimizes the constant. Measured on our own runs; records that B3 cache-layout discipline is marked built but isn't, and a live accounting bug that would report a fake win if caching were enabled. |

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
