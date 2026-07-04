# Rote — Trajectory Memoization for Agent Harnesses

> **Compression makes every token cheaper. Rote makes most tokens not exist.**

Agents re-derive already-solved workflows on every run: 40 tool calls and 200K tokens to
rediscover a procedure they executed successfully yesterday. Rote is harness middleware
that **captures** a successful trajectory once, **distills** it into a parameterized,
assertion-gated playbook, **replays** it deterministically for a fraction of the cost, and
**self-heals** it when the environment drifts.

![Architecture](diagrams/architecture.svg)

## The economics in one table

| | Cold (run 1) | Warm (run N) | Drift (run N+k) |
|---|---|---|---|
| LLM in control loop | every step | never | one step |
| Tool calls | ~40 | ~6 | ~8 |
| Tokens | ~210K | ~18K (−91%) | ~31K (−85%) |

Control flow becomes deterministic; the LLM is reserved for what actually needs judgment —
binding parameters, filling content slots, and repairing broken steps.

## Docs

| Doc | Contents |
|---|---|
| [01 — Problem](01-problem.md) | The reuse-path gap: read path (compression) and write path (Mem0/Zep) are crowded; nobody owns replay |
| [02 — Architecture](02-architecture.md) | Recorder → Distiller → Playbook Store → Matcher → Replay Executor → Repair ladder; failure-safety invariants |
| [03 — Wedge Benchmark](03-wedge-benchmark.md) | "Run it twice": task suite, metrics, kill thresholds, 90-second demo script |
| [04 — Market](04-market.md) | Competitive map, three steelmanned objections, buyers, why now |
| [05 — Roadmap](05-roadmap.md) | Phase 0 gate → OSS release → control plane; open questions |
| [06 — Build Plan](06-build-plan.md) | Milestone-by-milestone execution: tasks, automated + manual tests, exit/kill gates |

## Diagrams

- [`diagrams/architecture.svg`](diagrams/architecture.svg) — system overview
- [`diagrams/run-lifecycle.svg`](diagrams/run-lifecycle.svg) — cold / warm / drift economics
- [`diagrams/repair-ladder.svg`](diagrams/repair-ladder.svg) — self-healing state machine

## Design invariants (the short list)

1. **Never silently wrong** — every replayed step is assertion-gated.
2. **Never worse than baseline** — full-agent fallback always exists.
3. **Never cross environments** — structural fingerprints are a hard gate.
4. **Everything versioned** — playbooks and repair patches are append-only, auditable, diffable.
