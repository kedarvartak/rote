# 14 — Optimization Catalog: Everything an Efficient Browser-Agent System Needs

> Status: design, researched 2026-07. The master inventory behind
> [13 — The Rote Agent System](13-agent-system.md). Each entry: what it is, why it pays
> (with evidence), who ships it today, and Rote's plan with a priority tier.
> Tiers: **P0** = in the first competitive build; **P1** = fast follow, measured ROI;
> **P2** = later/optional. "Who has it" is per [15 — Competitor Teardown](15-competitor-teardown.md).

Cost model refresher (units matter): per step, cost ≈ observation tokens (input) +
history tokens (input, cached or not) + reasoning/output tokens + wall-clock =
model think time + action time + page settle time + observation build time. Input
tokens dominate agentic spend (~85%); observations dominate input; latency is
serialized. Every entry below attacks one of those terms.

---

## A. Perception plane — what the model sees

### A1. Semantic DOM distillation (P0)
Raw DOM → a compact tree of *interactive and content-bearing* elements only (role,
name, state, stable ID), built from CDP accessibility + layout + hit-testing data.
The baseline everyone needs: raw HTML can take >100 lines per logical form field;
a11y-tree extraction alone is ~10× smaller than DOM. Browser Use's DOM engine
(500–2000 elements/page in 10–100ms) is the open-source reference; Pinchtab shows the
same via pure a11y. **Rote**: build once, well — CDP-native, no Playwright dependency
in the hot path; stable node IDs are the foundation for A3/A4/C2.

### A2. Interactive-element detection beyond ARIA (P0)
Custom widgets (div-with-onclick, cursor styles, framework listeners) are invisible to
naive a11y walks. Detection = native semantics ∪ event-listener probing ∪ computed
cursor ∪ heuristics. Browser Use treats this as a core engine concern; it's why their
distiller is trusted. **Rote**: same union approach; cache per-frame with DOM-mutation
invalidation (their 95% cache hit rate on re-walks is the bar).

### A3. Stable element IDs across steps (P0)
IDs that survive re-renders (content+role+ancestry hashing, not DOM index), so the
model can say `click(#e42)` across turns, history stays meaningful, and diffs (A4) can
say "changed" instead of re-listing. Pinchtab ships "stable element refs"; most
harnesses renumber every step, silently breaking history compression. **Rote**: stable
IDs are a schema-level commitment (they appear in trajectories, playbooks, memory).

### A4. Diff-encoded observations (P0 — a signature move)
After the first full snapshot on a page, send only what changed. Research: diff-based
history is token-efficient *and improves performance* (arXiv 2604.01535); nobody ships
it as the default representation. Requires A3. Includes an honesty guard: if diff >
~60% of full, send full. **Rote**: default-on within a page identity; speculation
(doc 11) pre-computes the next diff during think time.

### A5. Task-focused observation filtering (P1)
Rank/prune the distilled tree by relevance to the current task (embedding or
small-model scoring; FocusAgent uses LLM-guided retrieval over a11y trees, LineRetriever
plans-aware line selection). Complementary to A4 (diff = temporal, this = topical).
**Rote**: P1 because it needs quality evals — over-pruning causes silent blindness;
ship behind the token budgeter (A8) with the full tree one request away.

### A6. Signal-driven re-observation (P1)
Don't re-observe on a timer or every step — re-observe when a cheap signal fires
(URL change, DOM mutation burst, network activity, action failure). arXiv 2606.06708
validates; harnesses mostly re-snapshot unconditionally. **Rote**: the settledness
detector (C1) and the mutation observer share instrumentation; re-observation becomes
event-driven by construction.

### A7. Selective vision with set-of-marks (P1)
Screenshots only when structure fails: canvas/WebGL, visual-layout questions, CAPTCHAs,
verification of spatial claims. When used, overlay numbered marks aligned to A3 IDs
(set-of-marks) so vision output grounds back to actionable elements. Evidence: SoM
agents on frontier models cost >10× per task vs efficient models — vision is the
expensive path and must be *elective*. Skyvern is vision-first (their choice, their
cost); Browser Use added optional vision. **Rote**: a11y-first, vision as an escalation
tool with its own budget line in accounting.

### A8. Observation token budgeter (P0)
A hard per-step budget (default e.g. 4K tokens) that the renderer must meet by
degrading gracefully: diff → filtered tree → summary + "expand" affordance. Enterprise
pages hit 40–500K tokens raw (WorkArena); without a budgeter one bad page destroys a
session's economics. Nobody ships an explicit budget contract. **Rote**: the renderer's
output is *contractually* bounded; the model can spend budget explicitly via a
`read_more(region)` tool — pull, not push.

### A9. WebMCP-first perception (P1)
If the site exposes `navigator.modelContext` tools (Chrome 146+ origin trial; Google/
Microsoft backing; Expedia/Shopify/Target experimenting), use the site's own typed
tools and skip DOM perception entirely (~89% token savings claimed for tool-based vs
scraped interaction). **Rote**: perception ladder = WebMCP → distilled a11y → vision;
first harness to treat the standard as the primary path wins free efficiency and
free press.

### A10. Cross-step content dedup (P2)
The same table/nav/footer re-rendered on every page of a site should be sent once and
referenced thereafter ("nav unchanged, see step 3"). Requires content-addressed chunk
hashing over A1 output. Nobody does it; pure win on portal flows with heavy shared
chrome. **Rote**: P2 — falls out of A3/A4 infrastructure once stable.

---

## B. Decision plane — when and which model

### B1. Model routing by step class (P0)
Frontier model for planning, task decomposition, recovery, judgment; small grounded
model for routine "next action on a clear page" steps. Evidence: Fara-7B (7B,
screenshot-native) approaches frontier computer-use success at a fraction of cost;
UI-TARS-class models same lane. No mainstream harness routes per-step (they pick one
model per session). **Rote**: router with confidence escalation — small model's
uncertainty (or expect-failure) escalates to frontier; all tagged per invariant 5.

### B2. No-model steps: replay + speculation (P0 — the moat)
The cheapest model call is none. Verified playbook replay (doc 02, built) removes the
model from stable flows; memory-driven speculation (doc 11) removes act/observe
latency and pre-stages steps even mid-exploration. Competitors' nearest: Stagehand
selector caching, Skyvern code caching, workflow-use — all exact-repetition, none
speculative, none with per-step verification contracts. **Rote**: this is docs 02/08/11;
in the harness it's just the router's top two priority classes.

### B3. Cache-locality-aware context layout (P0)
Prompt-cache reads are ~10× cheaper; agent loops re-send the whole transcript every
step, so hit rate ≈ spend. Layout rules: stable system prompt + tool defs first;
per-site brief next (stable within a session); volatile working state at the tail;
never a timestamp/UUID in the prefix; compaction scheduled at cache-economic moments,
not at limit-panic. A real team went 7%→84% hit rate by hand-fixing layout — harnesses
don't manage this deliberately. **Rote**: layout is owned by one module with tests
that fail on prefix-volatility regressions.

### B4. History compaction, agent-shaped (P1)
Superseded tool results (old observations of since-navigated pages, fixed test
outputs) tombstoned aggressively *near the tail* (before they age into the expensive
cached prefix); summaries preserve decisions and dead-ends. Labs ship generic versions
(Anthropic context editing, server-side compaction); a browser harness knows *which*
results are superseded (page navigated away = observation dead) and can be far more
surgical. **Rote**: P1, integrates with B3's scheduling math.

### B5. Structured decision output (P1)
Constrained action schema (JSON/tool-call with typed args against the A3 ID space)
rather than free-form reasoning + parse. Cuts output tokens (the 10× SoM cost cite is
mostly verbose output), kills parse failures, enables strict validation. Everyone does
a version; quality varies. **Rote**: Zod-schema'd action space (doc 16), reasoning
optional and budgeted, not default.

### B6. Prefill/short-circuit hints (P2)
When memory predicts top-1 next action with medium confidence (not enough to
speculate), present it as a proposal the model confirms in a few tokens instead of
deriving from scratch. Doc 08's advisory mode, decision-plane edition. **Rote**: P2 —
needs careful eval to avoid anchoring the model into stale suggestions.

---

## C. Action plane — executing without waste

### C1. Settledness detection (P0)
"Is the page done?" is the top flakiness source: naive fixed sleeps waste seconds per
step; premature observation wastes a whole model round-trip on a half-rendered page.
Composite signal: network quiescence + DOM mutation quiescence + layout stability +
spinner/skeleton heuristics + framework hooks, with a hard cap. Playwright's built-ins
are known-insufficient for SPAs; every harness hand-rolls something. **Rote**: one
well-tested detector, exposed as an event (feeds A6), tuned per-site by memory
(observed settle times become site facts, doc 08).

### C2. Self-healing element resolution (P0)
Actions target semantic descriptors (role+name+context), resolved to concrete nodes at
execution with fallback strategies; selector breakage becomes a resolution retry, not
a task failure. Stagehand (act + auto-heal) and workflow-use (semantic selectors,
fallback chains) prove the pattern. **Rote**: resolution strategies ranked by memory
confidence (doc 08 selector map); every resolution outcome recorded — healing feeds
learning instead of being amnesiac.

### C3. Speculative pre-execution (P0 — signature move)
Doc 11 wholesale: shadow-context execution of predicted next actions during model
think time; promote-on-hit, discard-on-miss; never past the effect boundary. Research
ceiling with blind draft models: ~55% prediction accuracy → ~20% latency; with
trajectory memory as predictor, warm-site accuracy should be far higher (M4 kill gate:
≥70%). Nobody ships it. **Rote**: the action plane owns shadows + promotion (doc 16).

### C4. Typed, minimal action space (P0)
Small closed verb set (navigate, click, fill, select, press, scroll, extract, wait,
read_more, done/fail) with schema'd args — not 50 overlapping tools. Bigger action
spaces cost tokens in tool definitions (prefix bloat vs B3) and confuse routing.
**Rote**: core builds the schemas; extensions are namespaced and off by default.

### C5. Batched micro-actions (P1)
Form-filling as one `fill_form([{id, value}…])` call instead of N fill round-trips —
N−1 fewer model turns on the most common enterprise flow. Requires C1 to confirm
between batch items cheaply and expect checks per item (invariant 1 held per field).
Skyvern's block execution approximates this. **Rote**: P1, natural once C4+C1 exist.

### C6. Per-step expect assertions (P0 — carried over, non-negotiable)
The Expect DSL (built, M0/M2) gates every action's outcome — in replay, speculation
commit, *and* live agent mode (the agent's own actions get postcondition checks where
memory knows what to expect). This is an efficiency feature too: catching a failed
click immediately costs one assertion; discovering it three steps later costs a
recovery arc. **Rote**: already built; the harness wires it everywhere.

---

## D. Learning plane — compounding (docs 02/08/11, inventoried for completeness)

### D1. Always-on trajectory recording (P0 — built)
M1's recorder: append-only, crash-safe, fsync-per-event, blob-spilled. The substrate
for everything below. No competitor records losslessly by default.

### D2. Playbook distillation + verified replay (P0 — executor built, distiller pending)
Doc 02. Exact-task repetition → zero-model execution with per-step + final verify.
Competitors have exact-repeat caching without the verification contract.

### D3. Site memory: selector maps, form semantics, page graph, quirks (P0)
Doc 08 tier 3. Serves briefs, biases C2 resolution, calibrates C1 settle times,
classifies C3 safety. Confidence + freshness + append-only versioning.

### D4. Transition models + trace matching for prediction (P0)
Doc 11's predictor: the branch history table over recorded runs. Also serves B6 hints.

### D5. Subflow mining (P1)
Doc 08 tier 2: shared prefixes (login → dashboard → section) replayed across different
tasks with a hand-off contract.

### D6. Drift tracking + proactive re-distillation (P1)
Doc 02 component 7: rising repair/misprediction rates on a surface trigger re-learning
before users see degradation. Doubles as the observability product surface.

---

## E. Browser infrastructure plane

### E1. CDP-direct control (P0)
Drive Chrome via CDP directly (as Browser Use moved to); Playwright/Selenium layers add
latency, version drag, and abstraction mismatch in the hot loop. Steel's control-plane
benchmark (~229ms, 1.6–28× faster than rivals) shows infra latency is a real, measured
axis. **Rote**: CDP-native core; Playwright only as an optional adapter for users who
bring it.

### E2. Infra-agnostic session backend (P0)
Local Chrome, Browserbase, Steel (open-source, self-hostable), Hyperbrowser, Anchor —
behind one session interface (launch, connect, clone-state, dispose). The infra
providers are partners, not competitors (doc 13); portability is also negotiating
leverage for users. **Rote**: `SessionBackend` interface in core; shadow-context
support (C3) capability-detected per backend.

### E3. Session/state persistence and warm starts (P1)
Persist cookies/storage per (user × site) so runs start authenticated at the
dashboard, not at the login page — the cheapest tokens are the login flow you skip.
All infra providers ship profiles/contexts; harnesses underuse them. **Rote**: profile
store keyed by fingerprint, integrated with D3 (the page graph knows where a warm
session can start).

### E4. Anti-bot hygiene (P2, deliberately bounded)
Fingerprint sanity, human-like pacing where *authorized* automation demands it.
Hyperbrowser/Anchor compete on stealth-by-default; that's their lane and partly an
arms race we don't want to own. **Rote**: consume the backend's stealth via E2; don't
build evasion in-house; document the authorized-use stance.

### E5. Parallel session fan-out (P1)
Independent subtasks (check 5 vendors) run in parallel sessions/tabs with a merge
step. Cuts wall-clock linearly on fan-out-shaped tasks; requires the planner to emit a
DAG, which the playbook schema already is. **Rote**: P1; the session virtualizer
(doc 11/16) already manages multiple contexts — fan-out reuses that machinery.

---

## F. Reliability & verification plane (efficiency's precondition)

### F1. Task-level verify gate (P0 — built)
Doc 02 / invariant 1. Success is only reported after `verify[]` passes. Also the
anchor for every efficiency claim: all benchmark numbers are *at success parity*.

### F2. Recovery ladder (P1)
Retry (transient) → scoped repair (one step, narrow context) → fallback (full agent,
recorded, re-learned) — doc 02's repair ladder, now with the agent itself as the
fallback tier. Cheap recovery is an efficiency feature: a scoped repair costs ~one
step; a blind restart costs the whole task.

### F3. Prompt-injection containment (P1)
Page content is untrusted input. Containment at the perception boundary: mark
DOM-derived text as data (delimiting/quoting conventions), strip instruction-shaped
content from element names in the distilled tree, never auto-follow page-suggested
navigation across the effect boundary without policy. Labs handle model-side; the
harness must handle representation-side. **Rote**: P1, with an adversarial fixture
suite (pages that try to hijack the distiller).

### F4. Deterministic eval + drift suites (P0 for CI)
Fake-world fixtures (built) + scripted DOM mutation suites (doc 03 B5/B6 discipline)
+ latency-configurable downstream (doc 12 M6). Competitors eval on live sites and
flake; our CI determinism is why the invariant suites mean something.

---

## G. Telemetry plane

### G1. Per-source token & latency accounting (P0 — partially built)
Invariant 5's tagging (planner/matcher/slot/judgment/repair/verify/distill + predict)
extended with per-plane latency spans. The benchmark harness (M3, built) already
consumes this. No competitor gives users a "where did my tokens go, per step class,
per site" report. **Rote**: the report *is* the sales demo.

### G2. Efficiency regression CI (P1)
Token/latency budgets per fixture task enforced in CI — an efficiency regression fails
the build like a correctness regression. Nobody does this; it's how the cost curve
stays sold-as-advertised.

---

## Priority summary

| Tier | Entries |
|---|---|
| **P0** | A1 A2 A3 A4 A8, B1 B2 B3 B5*, C1 C2 C3 C4 C6, D1–D4, E1 E2, F1 F4, G1 (*B5 is P1 in text — P0 the schema, P1 the eval polish) |
| **P1** | A5 A6 A7 A9, B4 B6→(P2) , C5, D5 D6, E3 E5, F2 F3, G2 |
| **P2** | A10, B6, E4 |

The P0 set is deliberately the four signature moves (diff observations, no-model
steps, speculation, cache layout) plus the table stakes they depend on (distillation,
stable IDs, settledness, typed actions, recording, verification). Build order and
component boundaries: [16 — Harness Architecture](16-harness-architecture.md).

## Evidence index

- Browser Use DOM engine internals: [DeepWiki: DOM processing](https://deepwiki.com/browser-use/browser-use/2.4-dom-processing-engine), [interactive element detection](https://deepwiki.com/browser-use/browser-use/5.3-interactive-element-detection)
- Diff observations: [arXiv 2604.01535](https://arxiv.org/abs/2604.01535); focused filtering: [FocusAgent](https://arxiv.org/html/2510.03204), [LineRetriever](https://arxiv.org/html/2507.00210v1); signal-driven: [arXiv 2606.06708](https://arxiv.org/pdf/2606.06708)
- Speculative execution: [Speculative Actions](https://arxiv.org/abs/2510.04371), [PASTE](https://arxiv.org/html/2603.18897v1)
- Small grounded models: [Fara-7B](https://www.microsoft.com/en-us/research/blog/fara-7b-an-efficient-agentic-model-for-computer-use/) (incl. the >10× SoM cost observation)
- Workflow memory: [AWM](https://arxiv.org/abs/2409.07429); hierarchical memory: [arXiv 2603.07024](https://arxiv.org/html/2603.07024)
- Prompt-cache economics: [caching guide w/ 7%→84% case](https://www.digitalapplied.com/blog/prompt-caching-2026-cut-llm-costs-engineering-guide); input-token dominance: [Vantage](https://www.vantage.sh/blog/agentic-coding-costs)
- Infra latency: [Steel remote-browser benchmark](https://steel.dev/blog/remote-browser-benchmark); landscape: [Browserbase vs Steel vs Hyperbrowser](https://www.pkgpulse.com/guides/browserbase-vs-hyperbrowser-vs-steel-cloud-browsers-ai-2026)
- WebMCP: [spec status](https://studiomeyer.io/en/blog/webmcp-reality-check-may-2026), [token-savings claims](https://agentmarketcap.ai/blog/2026/04/07/chrome-firefox-native-agent-apis-2026-browser-agentic-primitives)
- Observation size reality: [WorkArena/BrowserGym token counts via benchmark survey](https://arxiv.org/html/2504.01382v4)
