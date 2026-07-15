# 06 — Optimization Catalog

> The master inventory: every optimization an efficient browser-agent system needs, what
> it's worth, who ships it, and where Rote stands. IDs (A4, C3, …) are cited throughout
> the docs and the code.
>
> **Tiers:** P0 = first competitive build · P1 = fast follow, by measured ROI · P2 = later.
> **Status:** ✅ built · ◐ partial · ○ designed only. See [02 §Status](02-architecture.md).

## Cost model (units matter)

```
per step:  cost ≈ observation tokens + history tokens + reasoning/output tokens
           time ≈ model think + action + page settle + observation build
```

Input tokens dominate agentic spend (~85%); observations dominate input; latency is
serialized. **Every entry below attacks one of those terms.**

---

## A · Perception — what the model sees

| ID | Optimization | Tier | Status |
|---|---|---|---|
| **A1** | **Semantic DOM distillation.** Raw DOM → compact tree of interactive/content-bearing elements only (role, name, state, stable ID) from CDP a11y + layout + hit-testing. Raw HTML can exceed 100 lines per form field; a11y extraction is ~10× smaller. Browser Use's engine is the OSS reference. *Rote: CDP-native, no Playwright in the hot path.* | P0 | ✅ |
| **A2** | **Interactive-element detection beyond ARIA.** Custom widgets (div-with-onclick, cursor styles, framework listeners) are invisible to naive a11y walks. Detection = native semantics ∪ listener probing ∪ computed cursor ∪ heuristics, cached per frame with mutation invalidation. | P0 | ✅ |
| **A3** | **Stable element IDs.** Content+role+ancestry hashing, not DOM index — so IDs survive re-renders, history stays meaningful, and A4 can say "changed" instead of re-listing. Most harnesses renumber every step and silently break history reuse. *Schema-level commitment: IDs appear in trajectories, playbooks, memory.* | P0 | ✅ |
| **A4** | **Diff-encoded observations — a signature move.** After the first snapshot, send only what changed. Research: diff-based history is token-efficient *and improves task performance*; nobody ships it as the default representation. Requires A3. Honesty guard: if diff >~60% of full, send full. | P0 | ✅ |
| **A5** | **Task-focused filtering.** Rank/prune the tree by relevance (embedding or small-model scoring). Complementary to A4: diff is temporal, this is topical. *P1 because over-pruning causes silent blindness — needs quality evals; ship behind A8 with the full tree one request away.* | P1 | ○ |
| **A6** | **Signal-driven re-observation.** Re-observe when a cheap signal fires (URL change, mutation burst, network activity, action failure) — not on a timer. Shares instrumentation with C1. | P1 | ◐ |
| **A7** | **Elective vision with set-of-marks.** Screenshots only when structure fails (canvas/WebGL, spatial questions, CAPTCHAs). Marks aligned to A3 IDs so vision output grounds back to actionable elements. Evidence: SoM agents cost >10× per task vs efficient models — **vision is the expensive path and must be elective.** Skyvern/Magnitude are vision-first; that's their cost. | P1 | ○ |
| **A8** | **Observation token budgeter.** A hard per-step budget the renderer must meet by degrading: diff → filtered → summary + expand affordance. Enterprise pages hit 40–500K tokens raw; without a budget one bad page destroys a session's economics. Nobody ships a budget *contract*. *Pull, not push: the model spends budget via `read_more(region)`.* | P0 | ✅ |
| **A9** | **WebMCP-first perception.** If a site exposes `navigator.modelContext`, use its typed tools and skip DOM perception (~89% token savings claimed). Ladder: WebMCP → a11y distill → vision. First harness to treat the standard as primary wins free efficiency. | P1 | ○ |
| **A10** | **Cross-step content dedup.** Nav/footer/table re-rendered on every page sent once, referenced thereafter. Falls out of A3/A4 once stable. | P2 | ○ |

## B · Decision — when and which model

| ID | Optimization | Tier | Status |
|---|---|---|---|
| **B1** | **Model routing by step class.** Frontier for planning/recovery/judgment; small grounded model for routine "next action on a clear page". Fara-7B-class approaches frontier computer-use success at a fraction of cost. No mainstream harness routes per-step. *Router escalates on uncertainty or expect-failure; all tagged (invariant 5).* | P0 | ○ |
| **B2** | **No-model steps: replay + speculation — the moat.** The cheapest call is none. Verified replay removes the model from stable flows; speculation removes act/observe latency. Competitors' nearest: selector caching, code caching, workflow recorders — all exact-repetition, none verified per-step. | P0 | ◐ replay ✅, speculation ○ |
| **B3** | **Cache-locality-aware context layout.** Cache reads are ~10× cheaper and loops re-send the whole transcript, so **hit rate ≈ spend**. Stable prompt + tool defs first; site brief next; volatile tail last; never a timestamp in the prefix. A real team went 7%→84% by hand-fixing layout. *One module owns it, with tests that fail on prefix-volatility regressions.* | P0 | ✅ |
| **B4** | **Agent-shaped history compaction.** Tombstone superseded tool results *near the tail*, before they age into the expensive cached prefix. A browser harness knows *which* results are dead (page navigated away = observation dead) and can be far more surgical than generic context editing. | P1 | ○ |
| **B5** | **Structured decision output.** Constrained action schema against the A3 ID space, not free-form reasoning + parse. Cuts output tokens, kills parse failures, enables strict validation. | P0 schema | ✅ |
| **B6** | **Prefill/short-circuit hints.** When memory predicts top-1 with medium confidence, propose it for a few-token confirmation instead of deriving from scratch. *P2: needs eval to avoid anchoring the model on stale suggestions.* | P2 | ○ |

## C · Action — executing without waste

| ID | Optimization | Tier | Status |
|---|---|---|---|
| **C1** | **Settledness detection.** "Is the page done?" is the top flakiness source: fixed sleeps waste seconds/step; premature observation wastes a whole model round-trip on a half-rendered page. Composite: network + mutation quiescence + layout stability + spinner heuristics, hard-capped. Playwright's built-ins are known-insufficient for SPAs. *Exposed as an event (feeds A6); tunable per-site by memory.* | P0 | ✅ |
| **C2** | **Self-healing element resolution.** Actions target semantic descriptors, resolved at execution with a fallback chain (stable-ID → role+name → text-proximity). Selector breakage becomes a retry, not a task failure. *Every resolution outcome recorded — healing feeds learning instead of being amnesiac.* | P0 | ✅ |
| **C3** | **Speculative pre-execution — a signature move.** Shadow-context execution of predicted actions during think time; promote on hit, discard on miss, **never past the effect boundary**. Blind draft models reach ~55% accuracy → ~20% latency; trajectory memory should do far better on warm sites. Nobody ships it. | P0 | ○ |
| **C4** | **Typed, minimal action space.** A small closed verb set with schema'd args — not 50 overlapping tools. Bigger action spaces cost prefix tokens and confuse routing. | P0 | ✅ |
| **C5** | **Batched micro-actions.** `fill_form([{id, value}…])` instead of N round-trips — N−1 fewer model turns on the most common enterprise flow. Needs C1 between items and per-item expects (invariant 1 held per field). | P1 | ○ |
| **C6** | **Per-step expect assertions.** The Expect DSL gates every action's outcome — in replay, speculation commit, and live agent mode. An efficiency feature too: catching a failed click costs one assertion; discovering it three steps later costs a recovery arc. **⚠️ The live-agent form is currently mis-designed — see [T1](testing/T1-openai-dry-run.md), #49/#50.** | P0 | ◐ |

## D · Learning — compounding

| ID | Optimization | Tier | Status |
|---|---|---|---|
| **D1** | **Always-on trajectory recording.** Append-only, crash-safe, fsync-per-event, blob-spilled. The substrate for everything below. No competitor records losslessly by default. | P0 | ✅ |
| **D2** | **Playbook distillation + verified replay.** Exact-task repetition → zero-model execution with per-step and final verification. Competitors have exact-repeat caching *without* the verification contract. | P0 | ◐ executor ✅, distiller ○ |
| **D3** | **Site memory.** Selector maps, form semantics, page graph, quirks. Serves briefs, biases C2, calibrates C1, classifies C3 safety. Confidence + freshness + append-only versioning. | P0 | ○ |
| **D4** | **Transition models + trace matching.** The branch-history table over recorded runs; the predictor behind C3 and B6. | P0 | ○ |
| **D5** | **Subflow mining.** Shared prefixes (login → dashboard → section) replayed across different tasks with a hand-off contract. | P1 | ○ |
| **D6** | **Drift tracking + proactive re-distillation.** Rising repair/misprediction rates trigger re-learning before users see degradation. Doubles as the observability surface. | P1 | ○ |

## E · Browser infrastructure

| ID | Optimization | Tier | Status |
|---|---|---|---|
| **E1** | **CDP-direct control.** Playwright/Selenium add latency, version drag, and abstraction mismatch in the hot loop. Infra latency is a real measured axis (Steel's control-plane benchmark: ~229ms, 1.6–28× spread). | P0 | ✅ |
| **E2** | **Infra-agnostic session backend.** Local Chrome, Browserbase, Steel, Hyperbrowser, Anchor behind one interface (launch, connect, clone-state, dispose). Providers are partners; portability is user leverage. | P0 | ◐ local only |
| **E3** | **Session/state persistence, warm starts.** Persist cookies/storage per (user × site) so runs start authenticated at the dashboard, not the login page — **the cheapest tokens are the login flow you skip.** | P1 | ○ |
| **E4** | **Anti-bot hygiene.** Consume the backend's stealth; **don't build evasion in-house.** That's an arms race we don't want to own; document the authorized-use stance. | P2 | ○ |
| **E5** | **Parallel session fan-out.** Independent subtasks in parallel sessions with a merge step. Requires the planner to emit a DAG — which the playbook schema already is. | P1 | ○ |

## F · Reliability — efficiency's precondition

| ID | Optimization | Tier | Status |
|---|---|---|---|
| **F1** | **Task-level verify gate.** Invariant 1: success is only reported after `verify[]` passes. Also the anchor for every efficiency claim — **all benchmark numbers are at success parity.** | P0 | ✅ |
| **F2** | **Recovery ladder.** Retry → scoped repair (one step, narrow context) → fallback (full agent, recorded, re-learned). Cheap recovery *is* an efficiency feature: scoped repair costs ~one step, a blind restart costs the task. **Currently absent at the planner boundary — #51.** | P1 | ○ |
| **F3** | **Prompt-injection containment.** Page content is untrusted input. Contain at the *perception* boundary: mark DOM text as data, strip instruction-shaped content from element names, never auto-follow page-suggested navigation across the effect boundary. Labs handle model-side; the harness must handle representation-side. | P1 | ○ |
| **F4** | **Deterministic eval + drift suites.** Fake-world fixtures + scripted DOM mutation suites + latency-configurable downstream. Competitors eval on live sites and flake; **our CI determinism is why the invariant suites mean anything.** | P0 | ✅ |

## G · Telemetry

| ID | Optimization | Tier | Status |
|---|---|---|---|
| **G1** | **Per-source token & latency accounting.** Invariant 5's tagging, plus per-plane latency spans. No competitor gives users a "where did my tokens go, per step class, per site" report. **The report *is* the demo.** | P0 | ✅ |
| **G2** | **Efficiency-regression CI.** Token/latency budgets per fixture task, enforced in CI — an efficiency regression fails the build like a correctness regression. Nobody does this; it's how the cost curve stays as advertised. | P1 | ○ |

---

## The P0 set

The four **signature moves** — diff observations (A4), no-model steps (B2), speculation
(C3), cache layout (B3) — plus the table stakes they depend on: distillation (A1/A2),
stable IDs (A3), budgeting (A8), settledness (C1), typed actions (C4), recording (D1),
verification (F1/C6).

Everything else earns its way in by measured ROI.

## Evidence

- Browser Use DOM engine: [DeepWiki: DOM processing](https://deepwiki.com/browser-use/browser-use/2.4-dom-processing-engine) · [interactive element detection](https://deepwiki.com/browser-use/browser-use/5.3-interactive-element-detection)
- Diff observations: [arXiv 2604.01535](https://arxiv.org/abs/2604.01535) · filtering: [FocusAgent](https://arxiv.org/html/2510.03204), [LineRetriever](https://arxiv.org/html/2507.00210v1) · signal-driven: [arXiv 2606.06708](https://arxiv.org/pdf/2606.06708)
- Speculative execution: [Speculative Actions](https://arxiv.org/abs/2510.04371) · [PASTE](https://arxiv.org/html/2603.18897v1)
- Small grounded models: [Fara-7B](https://www.microsoft.com/en-us/research/blog/fara-7b-an-efficient-agentic-model-for-computer-use/) (incl. the >10× SoM cost observation)
- Workflow memory: [AWM](https://arxiv.org/abs/2409.07429) · hierarchical memory: [arXiv 2603.07024](https://arxiv.org/html/2603.07024)
- Prompt-cache economics: [caching guide, 7%→84% case](https://www.digitalapplied.com/blog/prompt-caching-2026-cut-llm-costs-engineering-guide) · input-token dominance: [Vantage](https://www.vantage.sh/blog/agentic-coding-costs)
- Infra latency: [Steel remote-browser benchmark](https://steel.dev/blog/remote-browser-benchmark)
- WebMCP: [spec status](https://studiomeyer.io/en/blog/webmcp-reality-check-may-2026) · [token-savings claims](https://agentmarketcap.ai/blog/2026/04/07/chrome-firefox-native-agent-apis-2026-browser-agentic-primitives)
- Observation size reality: [WorkArena/BrowserGym token counts](https://arxiv.org/html/2504.01382v4)
