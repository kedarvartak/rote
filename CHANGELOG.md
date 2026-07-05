# Changelog

All notable changes to Rote are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/) once releases begin.
Every PR must add an entry under **Unreleased** (see `CLAUDE.md` → Changelog) unless
labeled `skip-changelog`.

## [Unreleased]

### Added
- **M3**: `@rote/bench` package — deterministic benchmark matrix runner for `{task × phase × repetition}`, tagged token accounting from `RunManifest.token_usage` plus validated LLM usage sidecars, warm-vs-cold reduction summaries, M3 kill-gate evaluation, byte-stable Markdown report rendering, JSON spec loading via recorded run ids, `rote-bench report` / `rote-bench gate` / `rote-bench synthetic` CLIs, synthetic B1–B3 fake-world pack generation, and raw JSONL export helpers for reproducibility. Failed driver runs are retained as failed matrix cells so benchmark reports cannot silently drop failures.
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
- Project named **Rote** (previously working name "Memo")
- Removed named references to third-party compression tools from README and design docs
  in favor of generic "compression proxy" language — those tools were a reference point
  for the problem framing, not a competitor to name-check
- Added an ASCII banner to the root README
- Added `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, and `SECURITY.md`; set GitHub repo topics
