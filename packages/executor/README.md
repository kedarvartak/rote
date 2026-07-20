# @rote/executor

The replay executor: walks a `Playbook`'s step DAG against the real tool/LLM
boundary. No Matcher, no Distiller — playbook selection is the caller's job
(a CLI flag today; M4's job later). See `docs/02-architecture.md` "Replay
Executor" and `docs/05-roadmap.md` (M2) for the design behind this.

## Public API

See `src/index.ts`. Highlights:

- **`runPlaybook(playbook, params, deps)`** — the orchestrator. Walks steps in
  dependency order (`topoOrder`), dispatches `deterministic` steps through
  `deps.toolCaller`, `slot`/`judgment` steps through `deps.llmClient`,
  evaluates each step's `expect` against a running `WorldState`, applies
  `on_fail` (`retry` with a fixed policy, or `fallback` — `repair` isn't
  built until M6 and downgrades to an immediate fallback), then checks
  `verify[]` before ever reporting success. Emits its own trajectory via
  `@rote/recorder`'s building blocks — replays are runs too.
- **`evaluateExpect`** — pure: the closed Expect DSL against a `WorldState`.
- **`observationFromResult` / `mergeWorldState`** — pure: the tool-agnostic
  convention this package reads a result through (see "Known v1 limitations").
- **`ToolCaller` / `LlmClient`** — the two injected boundaries; `McpToolCaller`
  and `TaggedExecutorLlmClient` back provider-neutral MCP replay; the explicit
  `AnthropicLlmClient` remains available for opt-in compatibility, while
  `BrowserToolCaller` adapts a stateful CDP page for verified browser replay.
- **`rote-replay <playbook.yaml> --params '{...}'`** bin — reads
  `ROTE_DOWNSTREAM_COMMAND`/`ROTE_DOWNSTREAM_ARGS`, `ROTE_TARGET_IDENTITY`,
  `ROTE_TASK_SPEC`, `ROTE_BASE_DIR` from the environment; slot/judgment steps
  require only the selected provider's key (OpenAI by default).

## Known v1 limitations (tracked, not silently missing)

- **The tool-result observation convention is this package's own
  interpretation**, not something the design docs specify: a tool result may
  carry `url`, `visible_selectors`, `input_values`, `visible_text`, and
  `exit_code` fields, which accumulate into a persistent `WorldState` across
  steps (unmentioned fields persist rather than reset); `json_path_*`,
  `output_matches`, and `nonempty` read the step's own raw result, not the
  accumulated state. A real browser-automation MCP server would need to
  shape its results this way for `expect`/`verify` to mean anything — see
  `packages/executor/src/world-state.ts`.
- **Retry policy is a fixed executor-level constant** (`DEFAULT_RETRY_POLICY`:
  3 attempts, no backoff), not per-step-authored — `OnFailSchema` in
  `@rote/core` is a bare `retry | repair | fallback` enum with no attempt
  count. Deferred until real usage shows a fixed policy insufficient.
- **`on_fail: repair` downgrades to an immediate fallback.** M6 hasn't been
  built yet; pretending to retry or silently doing nothing would both be
  worse than an honest, immediate fallback.
- **Judgment steps bind their classification under their own step id**
  (e.g. `{{triage}}`), and slot steps under `llm_fill.into` — `@rote/core`'s
  `PlaybookSchema` now recognizes both as valid `{{param}}` sources in
  addition to declared `params[]` (a schema gap found while building this
  package, fixed in the same PR — see `packages/core/src/schemas/playbook.ts`).
- **No live MCP `initialize` handshake.** `McpToolCaller` sends `tools/call`
  directly; it assumes the downstream accepts calls without a prior
  handshake, matching the recorder's same simplification.
- **Provider clients have no retry/backoff of their own** for transient API
  errors — the executor's `on_fail: retry` policy is the only retry layer in
  v1. Calls delegate to the shared source-tagged `@rote/llm` boundary.

The stateful fixture browser playbooks live at
`fixtures/playbooks/browser-b1-stateful.yaml` and `browser-b2-stateful.yaml`; both replay
through real local Chrome with zero LLM calls in the opt-in CDP suite.

## Running tests

```bash
npm test --workspace @rote/executor
```

Every scenario in `docs/05-roadmap.md` M2's automated-test list runs
against fake `ToolCaller`/`LlmClient` doubles (`test/helpers/`), never a real
LLM or MCP server — see `test/executor.test.ts` and
`test/invariants/never-success-on-failed-verify.test.ts` for the sacred
invariant. `test/fixtures/fake-browser-downstream.mjs` is used for manual
end-to-end smoke tests of the `rote-replay` CLI against
`fixtures/playbooks/b1-download-report.yaml` and
`fixtures/playbooks/b2-vendor-registration.yaml`.
