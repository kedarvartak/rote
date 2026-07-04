# Changelog

All notable changes to Rote are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the
project adheres to [Semantic Versioning](https://semver.org/) once releases begin.
Every PR must add an entry under **Unreleased** (see `CLAUDE.md` → Changelog) unless
labeled `skip-changelog`.

## [Unreleased]

### Added
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
