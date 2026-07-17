# Changelog

All notable changes to Rote are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/) once releases begin.
Every PR must add an entry under **Unreleased** (see `CLAUDE.md` → Changelog) unless
labeled `skip-changelog`.

## [Unreleased]

### Docs
- **P1**: Redraw all design diagrams via the Excalidraw MCP (base hand-drawn Virgil font) around the memory spine, and state build status inside each diagram (solid = built, dashed = designed). The previous set predated the repositioning: it cited a dead doc number (docs/15), called the capability matrix's Rote column a "designed target" where docs/04 now insists it shows today's build, claimed diffs and provider cache hits as if live (both documented inert/absent), and framed the Skyvern comparison as "why Rote wins" where docs/04 concedes we are late to tier 1. Adds `tier0-curve.svg` — the O(n²) bill and the four levers on it, V1's headline, previously undiagrammed (embedded in README and docs/01); embeds the previously-orphaned perception pipeline in docs/02; rebuilds the package map with the packages that actually exist (`action`, `agent`, `llm` were missing). `t1-b2-false-negative.svg` is deliberately untouched as a historical test record. (#63)

### Fixed
- **P1**: Normalize token accounting across providers so a caching change can never be reported as a token reduction (#57). Anthropic's `usage.input_tokens` **excludes** cache activity while OpenAI's **includes** it, and `@rote/llm` read only that field on both — the same one-line bug breaking in opposite directions. Measured live on 2026-07-17 (`gpt-5.6-luna`, a ~4K prompt sent twice): OpenAI reports a flat `input_tokens=4027` cold and warm, so cached tokens were priced at the full base rate (~10x overstatement on the cached portion), while Anthropic's would have collapsed to 0 (a fake efficiency win, published by the instrument we use to prove efficiency claims). `TokenUsage` now carries provider-normalized `input_tokens` (uncached remainder) / `cache_read_tokens` / `cache_write_tokens`, property-tested on the contract `input + cache_read + cache_write === the provider's true prompt size`; `runCostUsd` prices each bucket at its published multiplier (reads ~0.1x, 5-minute writes 1.25x); unaccountable usage raises `TokenAccountingError` instead of defaulting to 0; and an Anthropic 1-hour cache write (2x base) is refused rather than mispriced as the 5-minute write we request. Also fixes a second instance of the same bug where the executor's LLM adapter hand-re-projected `{input_tokens, output_tokens}` and dropped cache accounting in transit.

### Docs
- **P1**: Correct the cache-related status claims after #57. B3 cache-layout discipline is still not built, but its prerequisite — provider-normalized cache accounting — now is. Fixes a wrong number introduced in the memory-spine revamp: the minimum cacheable prefix is model-dependent, not a flat ~1024 tokens (4096 on Opus 4.8/4.7/4.6/4.5 and Haiku 4.5, 2048 on Fable 5/Sonnet 4.6, 1024 on Sonnet 4.5 and older); our per-call prompts are 637–953, so the conclusion that caching would do nothing on our fixtures survives, but the threshold cited for it did not. Records the measured OpenAI cold/warm pair (`input_tokens=4027` flat) and the opposite-direction failure the old accounting produced on each provider.

### Docs
- **P1**: Reorganize the design docs around the memory spine. New thesis: agent harnesses all have memory but none *manages* it, so Rote is the memory manager — three tiers (0 working, within a run; 1 episodic, across runs of a task; 2 semantic, across tasks on a site), with the verify gate as the precondition for all three rather than a competing claim. V1 is re-scoped from "the cheapest loop" to **tier 0, working memory**, because tier 1 is table stakes (Skyvern ships it) while tier 0 is where the O(n²) exponent lives and no competitor is building. Corrects three status claims the docs got wrong: B3 cache-layout discipline was marked built and has no mechanism (#57), A4 diff observations are built but have never fired (fixtures too small), and observation eviction was built but never named (now A11). Adds a second launch gate — the curve — and leaves its threshold deliberately unset until the first honest measurement. Folds `docs/browser-memory-moat.md` into `01`/`02`/`04`/`05`/`06` and deletes it. Removes all emoji status marks in favour of text and the existing geometric marks.
- **P1**: Re-survey the competition (2026-07-16) and reposition on verified reuse. Skyvern already ships Rote's memoization thesis — agent-run → generated code → zero-LLM replay → auto-fallback, plus progressive branch coverage — so reuse is table stakes, not a wedge; the retracted claim of "finer-grained learning" is corrected. No harness verifies that a replayed run was *correct* (their fallbacks fire on runtime errors, so no-exception is read as success — cf. Skyvern #SKY-7577, a cached click succeeding against a missing element). New position: "the only harness that can prove the cheap path did the right thing", with WebMCP consumption recorded as the one place we are genuinely early (shipping in Edge 147, zero agents or harnesses consuming it, and no chicken-and-egg for the first-party enterprise portals that are our best-fit buyer).
- **P1**: Add `docs/browser-memory-moat.md` — agent loops are O(n²) in task length because the transcript is re-sent every step, and the field only optimizes the per-step constant. Measured on our own live runs (B2 input grows 637→953 over 10 steps; 21% of the input bill is re-sent history). Records three findings: `assemblePlannerContext` already drops old observations, so Rote's dominant quadratic term is gone and was never claimed; the A4 diff path has never fired because our fixtures are too small to trigger it; and B3 "cache-layout discipline" is marked built but has no mechanism — no `cache_control` is sent and the accounting cannot see a cache hit (#57).

### Fixed
- **P1**: Make action `expect` optional and give a failed postcondition one scoped repair instead of ending the run — a mandatory expect forced the planner to predict confirmation text it had never seen, failing B2 0/7 with correct form submissions recorded as failures. B2 now passes 11/11 on `gpt-5.6-luna` and `gpt-5.6-sol` at roughly neutral token cost (#49, #50)

### Added
- **P1**: `.env.example` documenting every environment variable the harness reads (provider selection, API keys, Chrome path, run artifacts, opt-in CDP tests), with the driver-injected benchmark variables called out as not-to-be-set.

### Fixed
- **P1**: Pin the model on every Rote run in the head-to-head plan. The plan omitted `--model`, so runs silently used the SDK default while the records still declared the model from `sources.json` — a record asserting a run it did not make, and a head-to-head that could compare two different models.

### Added
- **P1**: OpenAI model prices in the head-to-head price table (GPT-5.6/5.5/5.4 families, `gpt-5.3-codex`, and the `@rote/llm` default `gpt-4.1-mini`), captured from OpenAI's published pricing on 2026-07-15, so `$/task` is reported rather than `price unavailable` on an OpenAI-driven run.

### Changed
- **P1**: Browser Use runner takes `--provider anthropic|openai` (defaulting to `ROTE_LLM_PROVIDER`) instead of hardcoding `ChatAnthropic`, and `--model` now defaults to the model `tasks.json` pins for both harnesses — so running it with no flags is the fair comparison.
- **P1**: Head-to-head report is now the docs/05 W5 G1 report — latency (avg/p50/p95 ms) and \$-per-task columns alongside tokens, priced from a dated overridable table (`--prices`) that labels an unpriced model rather than reporting it as \$0 (#42).

### Docs
- **P1**: Consolidate the design docs from 18 documents to 6 (~27k → ~9k words). The set had accreted in layers — a middleware-era design, a browser-memory extension, a speculation design, then a harness redesign — each superseding the last without removing it, leaving four overlapping build plans, three competitor docs, two roadmaps, and a confident description of four packages that don't exist. Technical substance preserved (playbook spec, type spine, transfer matrix, optimization catalog with evidence); every doc now marks built vs designed, with `docs/02` §Status authoritative. All ~100 references across code, tests, and CLAUDE.md repointed.
- **P1**: Add `docs/testing/` — a numbered log of tests run against real Rote (live browser, live model, live key), starting with T1: the first OpenAI dry run of the B1–B3 fixtures. B1/B3 pass; B2 fails 0/7 on a design flaw where mandatory action `expect` asks the model to predict unseen page text (#49, #50, #51, #52).
- **P1**: Record the head-to-head grading rule in `docs/03` (competitors are graded by the same symmetric verification Rote applies to itself; a missing measurement is never scored) and replace `docs/05` W5's superseded "×5 runs" variance rule with the shipped ≥15-runs bootstrap lower bound.

### Added
- **P1**: Reproducible Browser Use competitor runner (`scripts/bench/headhead/`) plus a `rote-bench competitor-records` mapping step that stamps required fairness provenance onto raw adapter output, so both harnesses run the same fixture tasks from one task file into the head-to-head gate (docs/05 W5, #41).
- **P1**: Repetition fan-out (`repetitions: N`) in the `rote-bench run` command plan, and `rote run` now honors `ROTE_RUN_ID`, so one plan drives ≥15 real recorded Rote runs per task straight into the head-to-head assembler (docs/05 W5, #40).
- **P1**: `rote-bench records` head-to-head assembler that builds the comparison records from *real* recorded Rote run artifacts (summed from `.rote/runs` manifests, never hand-typed) merged with competitor sidecars, plus a generic `competitorRecordsFromRaw` adapter contract and a harness-label integrity check (docs/05 W5).
- **P1**: Head-to-head competitor benchmark adapter in `@rote/bench` — a harness-neutral run record, a Rote-cells-to-record bridge, per-task subject-vs-baseline aggregation, and a `rote-bench launch-gate` that passes only at success parity, with ≥15 successful runs per harness, and a seeded-bootstrap token-reduction confidence range whose lower bound clears the floor (docs/05 W5).
- **P1**: OpenAI Responses API support through the shared tagged LLM boundary, selected with `ROTE_LLM_PROVIDER=openai|anthropic` and preserving provider token accounting.
- **P1**: Append-only `rote candidate create` workflow that validates a browser playbook, computes its exact environment fingerprint, and writes a portable replay candidate.
- **P1**: Exact-fingerprint browser replay selection in `rote run`, with zero-LLM warm execution on match and classified clean cold fallback before replay on mismatch.
- **P1**: `BrowserToolCaller` and stateful B1/B2 browser playbooks for verified local-CDP replay with zero LLM calls and benchmark-compatible executor recording.
- **P1**: Stateful B1–B3 browser fixtures with login/download, vendor-submission, and catalog/product confirmation states for meaningful action expects and final verification.
- **P1**: Reproducible Rote-vs-Browser-Use serializer report/gate on identical fixtures, failing per fixture and explicitly labeling approximate token counts.
- **P1**: Accessibility-aware perception names from labels/ARIA plus pruning for computed-hidden controls, hidden inputs, empty content, duplicate static text, and option noise.
- **P1**: Ordered stable-ID observation diffs with exact reconstruction property tests and adaptive full → diff → summary rendering under hard context budgets.
- **P1**: Frozen B2 drift suite covering selector renames, wrapper insertion, ambiguous controls, stale-selector decoys, hidden replacements, and delayed SPA state without silent wrong actions.
- **P1**: Mandatory live browser action postconditions for selector visibility/absence, input values, URL substrings, and visible text; failed checks record an errored action and failure manifest.
- **P1**: Resilient browser element resolution using unique stable ID, role+name, and unambiguous text proximity, with each chosen strategy recorded and ambiguous matches rejected.
- **P1**: `@rote/action` settledness detection using CDP network activity plus DOM mutation quiet windows, automatically applied after browser actions in `rote run`.
- **P1**: `rote run` cold browser-task command that launches Chrome, uses the tagged planner, requires explicit text/URL verification, records artifacts, and reports token usage.
- **P1**: Browser-agent run recording with append-only action trajectories, benchmark-compatible manifests, planner token usage, and failure-safe action error recording.
- **P1**: Shared `@rote/llm` source-tagged provider boundary and a strict `TaggedLlmBrowserPlanner` that parses typed actions and retains per-step planner token usage.
- **P1**: Cache-stable browser planner context assembly that keeps instructions, task, and action schemas ahead of volatile compact observations and action history.
- **P1**: Opt-in CDP fixture smoke for `@rote/agent` that drives B1–B3 pages through the compact observe-plan-act loop.
- **P1**: `@rote/agent` compact-observation browser-agent loop that source-tags planner calls and applies navigate/fill/select/click/done actions against a page session.
- **P1**: Stateful CDP page sessions with navigation, capture, fill, select, and click actions for the V1 browser-agent loop.
- **P1**: CDP fixture coverage for B1–B3, an exported local `FixtureSiteServer`, and opt-in CDP-to-perception distillation tests for the V1 browser-agent harness.
- **P1**: `@rote/browser` and `@rote/perception` foundation packages with deterministic fixture capture, minimal local Chrome/CDP page capture, compact interactive-node distillation, stable node IDs, budgeted observation rendering, and B1–B3 static HTML fixture pages for the V1 browser-agent harness.
- **M3**: live benchmark runbook, example B1–B3 command plan, and usage-sidecar JSON schema under `scripts/bench/` so real frozen browser-agent runs can plug into `rote-bench run` / `report` / `gate`.
- **M3**: frozen B1–B3 benchmark smoke scripts under `scripts/bench/` that drive the real Recorder and Replay Executor CLIs against the fake browser MCP downstream, then feed their artifacts through `rote-bench report` and `rote-bench gate`.
- **M3**: `@rote/bench` package — deterministic benchmark matrix runner for `{task × phase × repetition}`, command-plan driver for real/frozen benchmark runs, tagged token accounting from `RunManifest.token_usage` plus validated LLM usage sidecars, warm-vs-cold reduction summaries, M3 kill-gate evaluation, byte-stable Markdown report rendering, JSON spec loading via recorded run ids, `rote-bench run` / `report` / `gate` / `synthetic` CLIs, synthetic B1–B3 fake-world pack generation, and raw JSONL export helpers for reproducibility. Failed driver runs are retained as failed matrix cells so benchmark reports cannot silently drop failures.
- Design dossier: problem framing, architecture, wedge benchmark, market analysis,
  roadmap, and build plan with per-milestone test suites and kill gates (`docs/01`–`06`)
- Architecture, run-lifecycle, and repair-ladder diagrams (`docs/diagrams/`)
- Agent guidelines (`CLAUDE.md`), PR template, and CI pipeline with changelog enforcement
- **M0**: monorepo scaffolding (npm workspaces, TypeScript strict/NodeNext, ESLint flat
  config, Vitest) and the `@rote/core` package: Zod schemas for `TrajectoryEvent`,
  `RunManifest`, `EnvFingerprint` (+ hash-based fingerprinting), `Playbook` (with
  duplicate-id, cyclic-`depends_on`, undeclared-param, and judgment-step-cap
  validation), `Patch`, and the closed Expect DSL; pure `template.ts`
  (param extraction/rendering) and `digest.ts` (content digest + inline/blob storage
  decision); JSONL and YAML serializers; 80 tests (unit + property-based); hand-authored
  `fixtures/playbooks/b1-download-report.yaml`
- **M2**: `@rote/executor` — walks a `Playbook`'s step DAG against the real tool/LLM
  boundary: `deterministic` steps dispatch tool calls with zero LLM tokens, `slot` steps
  fill content via a scoped LLM call, `judgment` steps classify against a closed enum
  (out-of-enum is a hard error, never a silent branch). Every step's `expect` is checked
  against a running `WorldState`; `on_fail: retry` uses a fixed 3-attempt policy,
  `on_fail: repair` downgrades to an immediate fallback (M6 isn't built yet), and the
  final `verify[]` block is checked before ever reporting success — sacred invariant
  test in `test/invariants/never-success-on-failed-verify.test.ts`. The executor emits
  its own trajectory through `@rote/recorder`'s building blocks (replays are runs too).
  Real `McpToolCaller` and `AnthropicLlmClient` implementations back the
  `rote-replay <playbook> --params '{...}'` CLI. Hand-authored
  `fixtures/playbooks/b2-vendor-registration.yaml` (B2: multi-field form + a slot step).
  46 tests including all 10 Expect DSL primitives (pass/fail), retry/fallback/verify-failure
  scenarios, and a diamond-dependency topo-order case.
- `@rote/core`: `TokenUsageSourceSchema` gains a `judgment` source, distinct from `slot`
  (M2 needed to tag judgment-step LLM calls separately for M3's per-source accounting).
  `PlaybookSchema` now also accepts a `{{param}}` reference to a slot step's
  `llm_fill.into` or a judgment step's own id as a valid computed binding, not just a
  declared `params[]` entry — a gap M0's schema didn't anticipate until the executor
  needed to template on step-produced values.
- **M1**: `@rote/recorder` — a stdio MCP proxy that tees a downstream server's traffic
  unmodified while recording `tools/call` round-trips as `TrajectoryEvent`s
  (inline/blob storage by size) and writing a `RunManifest` at session end; env
  fingerprint captured from the client's own first `tools/list` response; append-only,
  fsync-per-event trajectory JSONL (sacred invariant test in
  `test/invariants/append-only.test.ts`); 36 tests including a real fake-downstream
  child process for fidelity, passthrough-on-failure, large-result blob spill,
  concurrency, and proxy overhead. `@rote/cli` — read-only `rote runs ls` / `rote runs
  show <run_id>`. Cross-package deep-import lint rule added now that a second package
  exists (CLAUDE.md "Modularity rules")

### Fixed
- Fixed a flaky `TrajectoryEvent` round-trip property test: `fc.jsonValue()` can generate
  `-0` inside `args`, but JSON has no negative zero (`JSON.stringify(-0) === "0"`), so the
  test now normalizes through one JSON pass before the first `parse()` — matching what a
  real recorder actually does — instead of asserting an in-memory JS value survives JSON
  with float sign intact.

### Docs
- Redraw all design diagrams with the Excalidraw MCP in the base Excalidraw hand-drawn font, add competitor-vs-Rote architecture diagrams (Browser Use, Stagehand, Skyvern, capability landscape) embedded in `docs/04`, and retire the `scenes.json`/`generate.mjs` diagram pipeline (#26)
- Document the shared source-tagged `packages/llm` provider boundary in the harness package layout.
- Rebuilt all five architecture visuals through the official Excalidraw MCP and checked in the MCP scene definitions, editable Excalidraw documents, and hand-drawn SVG exports.
- Replaced the outdated architecture, run-lifecycle, and repair-ladder diagrams; added current-vs-target package topology and perception-pipeline diagrams. All five ship as rendered SVG plus editable Excalidraw source, with implementation status marked explicitly in the visuals.
- Updated the root README, docs index, and new P1 package READMEs to describe Rote as an efficiency-first browser-agent harness with compact perception and browser memory.
- Build plans for the agent system: the six-week V1 launch plan with weekly gates and
  the no-number-no-launch rule (`docs/05`), and the full P0–P5 product roadmap with
  per-phase workstreams, exit/kill gates, dependency spine, and scope fences (`docs/05`)
- Direction of record: Rote is a full efficiency-first browser-agent system. New docs:
  the four-plane system design and positioning (`docs/02`), a researched catalog of
  every optimization the system needs with evidence, incumbents, and P0–P2 priorities
  (`docs/05`), a per-competitor teardown of harnesses/infra/models with a capability
  matrix (`docs/04`), and the component-level harness architecture with the control
  loop, type spine, and H1–H8 build order (`docs/02`); docs 02/10/12 and the README
  updated to point at the new direction
- Speculative execution design: overlap model think time with browser acting using
  recorded trajectories as the action predictor — predictor/classifier/session-virtualizer
  architecture with lossless commit gates and an effect boundary (`docs/02`), plus the
  reuse map and M4–M9 milestone sequence taking the existing packages there (`docs/05`);
  doc 05 M4+ sequencing superseded accordingly
- Browser-agent memory plan: three-tier memory architecture (playbook / subflow / site
  memory) with replay vs advisory consumption modes (`docs/02`), a generalization
  benchmark with a T0–T5 transfer matrix and kill gates (`docs/03`), and a survey of
  browser-agent memoization incumbents — Stagehand/Skyvern/workflow-use caching vs the
  generalization and harness-agnosticism gaps Rote targets (`docs/04`)
- Added `docs/01-problem.md` to scope Rote as a browser-agent memoization layer, explaining where site memory/replay helps and where one-off browsing does not.
- Project named **Rote** (previously working name "Memo")
- Removed named references to third-party compression tools from README and design docs
  in favor of generic "compression proxy" language — those tools were a reference point
  for the problem framing, not a competitor to name-check
- Added an ASCII banner to the root README
- Added `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`; set GitHub repo topics
