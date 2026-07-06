# 18 — Product Roadmap: The Full Timeline

> Status: living plan, 2026-07. The long-horizon companion to
> [17 — V1 Launch Plan](17-v1-launch-plan.md). Phases P0–P5 absorb doc 16's H1–H8 and
> doc 12's M4–M9 into one product timeline. Optimization IDs per
> [14](14-optimization-catalog.md); competitor references per [15](15-competitor-teardown.md).
>
> Planning assumptions, stated so slips are diagnosable: a small core team (1–3
> builders), OSS-first, calendar in quarters from 2026-Q3, every phase ends in a
> public launch or a killed hypothesis — never a silent fade. Durations are effort
> estimates, not promises; **gates are promises.**

## The arc in one table

| Phase | Theme | Launch headline | Target |
|---|---|---|---|
| P0 ✅ | Foundations (M0–M3) | — (internal) | done |
| P1 | **V1: the cheapest loop** | "Same tasks, fraction of the tokens — reproducible" | 2026-Q3 |
| P2 | **V2: the harness that learns** | "Your 50th task on a site costs a fraction of your 1st" | 2026-Q4 |
| P3 | **V3: faster than the model thinks** | "Warm flows bounded by think-time only" | 2027-Q1 |
| P4 | **Fleet & enterprise** | "Run 10K tasks/day, audited, at the lowest $ per task" | 2027-Q2–Q3 |
| P5 | **Platform** | "The efficiency substrate other agents build on" | 2027-Q4+ |

Cross-cutting tracks (never a phase, always running): invariants & test discipline,
benchmark cadence, community/OSS, docs-as-constitution. See §Tracks.

---

## P0 — Foundations ✅ (2026-Q2, done)

M0 core schemas/Expect DSL, M1 lossless recorder, M2 verified replay executor,
M3 benchmark matrix + accounting. 190+ tests, sacred invariant suites. Everything
carries forward unchanged (doc 16 §What changes for the existing packages).

## P1 — V1: the cheapest loop (2026-Q3, ~6 weeks of build)

Entire content: [17 — V1 Launch Plan](17-v1-launch-plan.md). Deliverables: CDP backend,
perception plane A1–A4+A8, context assembler B3, agent loop, action plane C1/C2/C4/C6,
head-to-head benchmark, `0.1.0` launch.

**Exit gate**: the W5 launch gate — tokens-per-task win at success parity, published.
**Kill honesty**: no win, no efficiency launch; regroup on doc 15's steelman #1.

## P2 — V2: the harness that learns (2026-Q4, ~8–10 weeks)

The learning plane goes live; the doc 09 learning curve becomes the product.

### Workstreams
1. **Predictor** (doc 12 M4, verbatim): trace matching + transition models + offline
   simulation. *The phase's kill gate comes first and costs no systems work*:
   ≥70% warm next-action accuracy on recorded runs, else P3's speculation thesis dies
   early and P2 re-scopes to memory-without-prediction.
2. **Distiller v1** [D2]: trajectory → playbook automation (doc 02 component 2 —
   causal pruning, parameterization, assertion synthesis). Replaces V1's hand-written
   playbooks. Gate: distilled playbooks replay the fixture suite with zero human edits.
3. **Site memory** [D3]: per-fingerprint store (selector maps, form semantics, page
   graph, settle-time priors, quirks); append-only, confidence + freshness (doc 08
   tier 3). Consumers wired: brief injection, memory-ranked resolution [C2+],
   settledness priors [C1+].
4. **Model routing** [B1]: router with `grounded-routine` class on a small model
   (Fara-7B-class local, or cheap hosted — doc 16 open question 1 decided here with
   data), escalation contract, per-site τ calibration. New `route`/`predict` tags
   (invariant 5, CLAUDE.md updated in the same PR).
5. **History compaction** [B4] inside the context assembler, cache-economics-scheduled.

### Exit gates
- Doc 09 T0 gate: ≥80% token reduction on exact-repeat tasks at parity (now with
  *automated* distillation).
- Doc 09 T2 gate: ≥30% token reduction on novel-task-on-known-site at parity
  (the generalization bet — kill/retreat rule per doc 09 if <15%).
- ≥50% of warm-flow steps routed off the frontier model at parity.
- **Launch**: "learning curve" blog + updated benchmark with a task-stream (not
  task-set) protocol; the marginal-cost chart is the hero image.

## P3 — V3: faster than the model thinks (2027-Q1, ~8–10 weeks)

The latency phase: speculation ships; wall-clock becomes the second headline number.

### Workstreams
1. **Session virtualizer** (doc 12 M5): virtual session ↔ live/shadow contexts,
   storage-state cloning, atomic promotion — soak under tests before speculation
   touches it.
2. **Prefetch speculation** (pure-read, live session — doc 12 M6): predicted
   observations pre-fetched + pre-diffed during think time.
3. **Shadow speculation + promotion** (doc 12 M8 / doc 11 full): safety classifier
   with evidence-based reclassification, effect-boundary fence, adversarial test
   suite that *tries* to trick the classifier, domain politeness caps.
4. **Pipeline depth + calibration** (doc 12 M9): multi-step speculation on
   high-confidence traces; auto-quiesce on hit-rate collapse.
5. **Subflow mining** [D5]: shared-prefix replay with hand-off (doc 08 tier 2) —
   rides on the same trace infrastructure.

### Exit gates (from docs 11/12/16)
- ≥30% end-to-end wall-clock reduction on warm fixture flows at parity (H5 gate).
- Zero speculated server-mutating calls across the adversarial suite — ever.
- Warm flows think-time-bound: act+observe ≤10% of step time at depth >1 (M9 gate).
- **Launch**: side-by-side latency demo (the doc 03 90-second script, now with a
  wall-clock meter), "CPU pipeline for browser agents" technical post.

## P4 — Fleet & enterprise (2027-Q2–Q3)

The buyer shifts from individual builder to fleet operator; reliability and
operability become the product. Sequenced by pull (design partners decide order).

### Workstreams
1. **Recovery ladder v2** [F2]: scoped repair agent (doc 02 component 6 — the M6
   design finally lands), patch versioning, rollback; drift tracker + proactive
   re-distillation [D6].
2. **Parallel fan-out** [E5]: planner-emitted DAGs across sessions; merge semantics;
   fleet scheduler.
3. **Auth & profiles** [E3]: per (identity × site) profile store, warm starts from the
   page graph, credential handling posture documented (never in trajectories —
   redaction at the recorder, invariant-grade tests).
4. **Injection containment** [F3]: representation-side defenses in the perception
   plane + adversarial page fixture suite; published threat model.
5. **Backends** [E2 full]: Browserbase/Steel/Hyperbrowser/Anchor certified backends,
   capability detection (shadow support varies), self-hosted Chrome pool recipe.
6. **Observability product** [G1+]: the "top 20 procedures, hit rates, what
   re-derivation costs you" report (doc 02 component 7) as a dashboard; per-site
   cost/latency/drift SLO views; efficiency-regression CI for *users'* suites [G2].
7. **Hosted control plane (first commercial surface)**: managed memory store,
   team-shared site memory with review workflow (memory changes as PRs), usage
   accounting. OSS harness stays complete — the control plane sells convenience,
   coordination, and audit, not withheld features.

### Exit gates
- 3+ design-partner fleets in production ≥30 days each; $/1K-tasks and drift-recovery
  SLOs met (targets set with partners, published as case studies).
- Security review (external) of injection containment + credential handling passes.
- **Launch**: enterprise GA + pricing; the observability dashboard demo.

## P5 — Platform (2027-Q4 →)

Rote as substrate. Directional, re-planned after P4 learnings:

- **WebMCP-first perception** [A9] as the standard matures past origin trial; publish
  the perception-ladder conformance story; co-marketing with early WebMCP sites.
- **Python SDK** (doc 16 open question 2) wrapping the MCP entry point; framework
  adapters (LangGraph node, Vercel AI SDK tool) — the "layer" entry point productized.
- **Memory exchange**: exportable/importable site-memory packs (fingerprint-gated,
  reviewed like code); possibly a public commons for consenting/open sites.
- **Second vertical probe**: the C1–C3 coding-agent tasks from doc 03 re-enter as an
  experiment — the planes are domain-general even though browser stays the product.
- **Model partnerships**: certified small-model routing configs (Fara-class,
  Haiku-class); latency-optimized serving for the `grounded-routine` class.

No gates set now — P5 is re-scoped at P4 exit by what the fleet market pulled.

---

## Tracks (always on)

| Track | Cadence | Rule |
|---|---|---|
| **Invariants & tests** | every PR | Sacred suite touches every new executor/agent exit path; CLAUDE.md invariants never phase-gated |
| **Benchmark** | every phase launch + quarterly re-run | Numbers re-published against current competitor versions; regressions acknowledged in public, not buried |
| **Community** | weekly from P1 launch | Issue triage SLO; good-first-issues per package; competitor-benchmark correction PRs get priority review |
| **Docs constitution** | every PR | Doc drift = bug (CLAUDE.md); this roadmap re-baselined at each phase exit with a dated changelog entry |

## Dependency spine (what blocks what)

```text
P1 perception (A1–A4,A8) ──▶ P2 site memory serving ──▶ P3 speculation predictor quality
P1 recorder-in-loop (D1) ──▶ P2 distiller + predictor ──▶ P3 trace matching depth
P1 context assembler (B3) ──▶ P2 compaction (B4) + routing prompts (B1)
P3 session virtualizer ──▶ P3 shadows ──▶ P4 parallel fan-out (same machinery)
P2 memory store ──▶ P4 team-shared memory / control plane
P1 bench adapters ──▶ every launch number thereafter
```

## Standing kill/retreat gates (the honest list)

1. **P2 predictor gate** (<70% warm accuracy): speculation retreats from P3; Rote
   remains distill+replay+memory — still a product, smaller claim.
2. **P2 generalization gate** (doc 09 T2 <15%): site memory retreats to replay support;
   the learning-curve pitch narrows to repeat-heavy fleets.
3. **P3 safety gate** (any effect-boundary violation reaches a real server in test):
   shadow speculation ships disabled-by-default until the classifier earns it back;
   prefetch-only mode is the floor.
4. **P4 pull gate** (no design partners by mid-P4): enterprise pauses; OSS + hosted
   memory continues; revisit ICP.
5. **The existential one** (doc 13 risk 2): if frontier cost/latency collapses far
   enough that parity-at-lower-cost stops mattering, the surviving assets are the
   verification contracts, the learning plane, and the benchmark reputation — pivot
   material is documented in docs 08/11 regardless.

## What we will not do (scope fences, revisit only by editing this doc)

- No stealth/anti-bot arms race in-house [E4 posture, doc 14].
- No open-ended-browsing/research-agent claims (doc 07's weak-fit list stands).
- No human-authored-workflow builder UI — agents discover procedures; humans audit
  them (doc 02 "What Rote is not").
- No cross-environment memory, ever (invariant 3).
