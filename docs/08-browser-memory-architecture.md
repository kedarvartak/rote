# 08 — Browser Memory Architecture: From Workflow Replay to Site Memory

> Status: design. This doc extends [02 — Architecture](02-architecture.md) for the
> browser-agent scope defined in [07 — Where Rote Works](07-where-rote-works.md). Nothing
> here invalidates M0–M2; it defines what gets built *on top* of them and in what order.

## The reframe

Rote v1 (docs 01–06) is **workflow memoization**: record a successful trajectory, distill
a playbook, replay it when the *same task* recurs. That is the cleanest thing to benchmark,
but it only pays when tasks repeat exactly (same site + same workflow + new params).

The goal: Rote is a **memoization layer for browser agents** whose promise is

```text
the more your browser agent uses a website, the less it explores it
```

— *including on tasks it has never done before* on that site. Exact-workflow replay
becomes the top tier of a three-tier memory, not the whole product.

## Why generalize beyond exact repeats

Two forces:

1. **Product**: real agent fleets don't re-run one frozen workflow; they run a *stream* of
   related tasks against the same handful of portals. "Register vendor" today, "update
   vendor bank details" tomorrow. Exact-match replay misses most of that stream even
   though 80% of the exploration cost (login, navigation, learning the DOM) is shared.
2. **Competition**: exact-repetition caching is already shipping inside the major browser
   harnesses (Stagehand action caching, Skyvern code caching, Browser Use workflow-use —
   see [10 — Competitive Landscape](10-competitive-landscape.md)). A replay-only Rote
   competes with free built-ins. A *generalizing, harness-agnostic* memory does not.

The academic signal that generalization works: **Agent Workflow Memory** (arXiv
2409.07429) induces reusable workflows from past trajectories and gains +24.6% relative
success on Mind2Web and +51.1% on WebArena — and its *cross-task / cross-site* condition
still gains 8.9–14.0 absolute points. Nobody has productized this.

## The three memory tiers

| Tier | Artifact | Reused when | Consumption mode | Token savings | Risk |
|---|---|---|---|---|---|
| 1. Playbook | Full parameterized step DAG | Same task class recurs on same site | **Replay** — deterministic execution, LLM out of the control loop | ~90% of a cold run | Highest (acting without the agent) — fully assertion-gated |
| 2. Subflow | Shared trajectory fragment (login, navigate-to-section, search-and-open) | A *different* task starts with a known prefix | **Replay prefix, then hand off** — agent takes over warm, mid-site | 30–60% (the prefix's share of exploration) | Medium — gated like tier 1, plus a clean hand-off contract |
| 3. Site memory | Per-site knowledge: page graph, selector map, form semantics, success signals | *Any* task touches a known site | **Advise** — memory never acts; it shrinks the agent's observation and guides its choices | 20–50% (fewer/cheaper observations, fewer dead ends) | Lowest — a wrong hint wastes tokens but the agent still observes and verifies |

Tier 1 is M0–M2, built. Tiers 2–3 are the roadmap. And all three tiers have a second
consumer beyond replay/advice: they are the knowledge sources for the **predictor** that
drives speculative execution ([11 — Speculative Execution](11-speculative-execution.md)) —
memory that is only *partially* right still pays there, because a predicted step that
confirms saves latency even when no full playbook matches.

### Tier 3 is the generalization engine

Site memory is a versioned, per-fingerprint store of *facts about a site*, each with
confidence and freshness:

```yaml
site: vendors.acme.com          # part of the env fingerprint — hard gate, invariant 3
pages:
  - id: vendor_dashboard
    reached_by: [login, nav_click_vendors]
    url_pattern: "/vendors"
    landmarks: ["#vendor-table", "text: Vendor Directory"]
selectors:
  - role: "vendor search box"
    selector: "#vendor-search"
    confidence: 0.97            # success_count / (success_count + failure_count), decayed
    last_verified: 2026-07-01   # freshness decays confidence
forms:
  - page: vendor_registration
    fields:
      - {selector: "#tax-id", meaning: "vendor tax identifier", format: "digits, 9–11"}
signals:
  success: [{text_visible: "Registration submitted"}]
  failure: [{selector_visible: ".error-banner"}]
quirks:
  - "submit button disabled until #terms checkbox checked"
```

Every fact is something the agent *paid tokens to discover* on a previous run. Site memory
is the accumulation of that spend.

## Consumption modes: replay vs advise

This is the load-bearing architectural change. v1 had one mode (replay). This design adds a
second that works on novel tasks:

### Replay mode (tiers 1–2) — unchanged contract
Deterministic execution, every step `expect`-gated, final `verify[]` before success,
repair ladder on drift. See doc 02.

### Advisory mode (tier 3) — the agent stays in control

Three mechanisms, in increasing order of intrusiveness:

1. **Site brief injection.** On task start against a known fingerprint, Rote composes a
   compact brief (target ≤2K tokens): relevant page graph slice, known selectors for the
   task's likely surface, form semantics, success signals, quirks. The agent reads it
   instead of re-deriving it from 20K+-token accessibility-tree dumps. (WorkArena-class
   enterprise pages run 40K–500K tokens per raw observation — this is where the mechanism
   pays most.)
2. **Observation substitution.** The MCP proxy intercepts expensive observation calls
   (`browser_get_accessibility_tree`, `browser_get_dom_summary`, screenshots) on pages
   whose landmark checks pass, and returns the *stored summary plus a live-verified diff*
   instead of the full dump. Landmark check fails → pass the real call through untouched.
3. **Action proposal.** Given the task and current page state, Rote proposes top-k
   candidate next actions from memory ("to search vendors, fill `#vendor-search` and press
   Enter — confidence 0.97"). Confirming a proposal is one cheap decision; deriving it
   from a raw DOM is an expensive one.

Safety mapping — how "never silently wrong" (invariant 1) holds per mode:

| Mode | Failure mode | Guard |
|---|---|---|
| Replay | Executes a wrong action | Per-step `expect` + final `verify[]` + repair ladder (existing) |
| Site brief / proposal | Agent follows a stale hint | Hint is *advice*, agent still observes outcomes; hints carry confidence + last-verified; a failed hint decrements confidence (recorded, not silent) |
| Observation substitution | Agent acts on a stale summary | **Most dangerous mechanism** — gated on live landmark verification per page; any landmark miss → full passthrough + memory marked stale. Ships last, behind a flag |

Invariant 2 (never worse than baseline) generalizes to: advisory overhead (brief tokens +
landmark checks) must stay a small, measured fraction of what it saves — this becomes a
benchmark metric, not a hope (see [09 — Evaluation](09-generalization-evaluation.md)).

## Component changes vs doc 02

| Component | v1 (doc 02) | Target |
|---|---|---|
| Recorder | Records trajectories | Unchanged — already captures everything the fact extractor needs |
| Distiller | Trajectory → playbook | Adds two outputs: **subflow mining** (frequent-prefix/fragment detection across playbooks of one fingerprint) and **fact extraction** (selectors, form semantics, page transitions, signals → site memory). Both offline, batchable |
| Store | Playbook store | Adds **site-memory store**, same rules: append-only, versioned, content-addressed, per-fingerprint (invariants 3–4). Confidence updates are appended observations, not in-place edits |
| Matcher | Task-level match → replay-or-miss | Becomes **multi-granularity**: fingerprint gate → playbook match (tier 1) → subflow prefix match (tier 2) → site-brief compose (tier 3, always on for known sites). A miss at every level = plain agent, unchanged |
| Executor | Replays playbooks | Unchanged for tiers 1–2 plus a **hand-off contract**: on subflow completion, emit verified world state summary to the agent's context |
| New: Advisor | — | Composes briefs, serves proposals, mediates observation substitution. Sits in the MCP proxy path the recorder already owns |
| Drift tracker | Per-playbook confidence | Extends naturally to per-fact confidence + freshness decay |

The MCP-proxy placement (doc 02 "Where Rote sits") is what makes this **harness-agnostic**
— the same memory serves a Claude-SDK agent, a Browser Use agent, or an in-house harness,
because browser MCP servers expose the same structured `navigate/click/fill/extract`
boundary. No shipping competitor works across harnesses (see doc 10).

## LLM call budget

New `source` tags on the shared LLM client (CLAUDE.md invariant 5): `distill` covers
subflow mining + fact extraction (offline); `matcher` covers brief composition;
advisory-mode proposals are `matcher`-tagged too — they must stay cheap-model, bounded
per run, and show up in per-source accounting so the benchmark can prove advisory overhead
is small.

## Build order (amends doc 06 — doc 06 to be updated when this is committed to)

M3 (benchmark, kill gate) stays exactly where it is: **prove tier 1 first** — if exact
replay can't show ≥80% reduction at parity, generalization is moot. Then:

| Milestone | Scope | Exit gate |
|---|---|---|
| M3 | Benchmark tier 1 (as designed, doc 03) | ≥80% token reduction at success parity |
| M4′ | Site-memory store + fact extraction from existing trajectories | Facts extracted from B1–B3 runs are correct against fixtures; append-only invariant tests |
| M5′ | Advisor: site brief injection only | Novel-task-on-known-site benchmark (doc 09) shows ≥30% token reduction at parity |
| M6′ | Subflow mining + prefix replay with hand-off | Related-task benchmark shows prefix reuse ≥50% of shared-prefix cost |
| M7′ | Action proposal; observation substitution behind a flag | Substitution shows zero staleness-caused failures across drift suite |

Ship order within advisory mode is safety order: brief (pure additive context) →
proposal (advice at decision points) → substitution (replaces ground truth — last, gated).

Next: [09 — Generalization Evaluation](09-generalization-evaluation.md)
