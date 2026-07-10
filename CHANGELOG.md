# Changelog

All notable changes to Rote are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/) once releases begin.
Every PR must add an entry under **Unreleased** (see `CLAUDE.md` → Changelog) unless
labeled `skip-changelog`.

## [Unreleased]

### Added
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
- Redraw all design diagrams with the Excalidraw MCP in the base Excalidraw hand-drawn font, add competitor-vs-Rote architecture diagrams (Browser Use, Stagehand, Skyvern, capability landscape) embedded in `docs/15`, and retire the `scenes.json`/`generate.mjs` diagram pipeline (#26)
- Document the shared source-tagged `packages/llm` provider boundary in the harness package layout.
- Rebuilt all five architecture visuals through the official Excalidraw MCP and checked in the MCP scene definitions, editable Excalidraw documents, and hand-drawn SVG exports.
- Replaced the outdated architecture, run-lifecycle, and repair-ladder diagrams; added current-vs-target package topology and perception-pipeline diagrams. All five ship as rendered SVG plus editable Excalidraw source, with implementation status marked explicitly in the visuals.
- Updated the root README, docs index, and new P1 package READMEs to describe Rote as an efficiency-first browser-agent harness with compact perception and browser memory.
- Build plans for the agent system: the six-week V1 launch plan with weekly gates and
  the no-number-no-launch rule (`docs/17`), and the full P0–P5 product roadmap with
  per-phase workstreams, exit/kill gates, dependency spine, and scope fences (`docs/18`)
- Direction of record: Rote is a full efficiency-first browser-agent system. New docs:
  the four-plane system design and positioning (`docs/13`), a researched catalog of
  every optimization the system needs with evidence, incumbents, and P0–P2 priorities
  (`docs/14`), a per-competitor teardown of harnesses/infra/models with a capability
  matrix (`docs/15`), and the component-level harness architecture with the control
  loop, type spine, and H1–H8 build order (`docs/16`); docs 02/10/12 and the README
  updated to point at the new direction
- Speculative execution design: overlap model think time with browser acting using
  recorded trajectories as the action predictor — predictor/classifier/session-virtualizer
  architecture with lossless commit gates and an effect boundary (`docs/11`), plus the
  reuse map and M4–M9 milestone sequence taking the existing packages there (`docs/12`);
  doc 06 M4+ sequencing superseded accordingly
- Browser-agent memory plan: three-tier memory architecture (playbook / subflow / site
  memory) with replay vs advisory consumption modes (`docs/08`), a generalization
  benchmark with a T0–T5 transfer matrix and kill gates (`docs/09`), and a survey of
  browser-agent memoization incumbents — Stagehand/Skyvern/workflow-use caching vs the
  generalization and harness-agnosticism gaps Rote targets (`docs/10`)
- Added `docs/07-where-rote-works.md` to scope Rote as a browser-agent memoization layer, explaining where site memory/replay helps and where one-off browsing does not.
- Project named **Rote** (previously working name "Memo")
- Removed named references to third-party compression tools from README and design docs
  in favor of generic "compression proxy" language — those tools were a reference point
  for the problem framing, not a competitor to name-check
- Added an ASCII banner to the root README
- Added `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`; set GitHub repo topics
