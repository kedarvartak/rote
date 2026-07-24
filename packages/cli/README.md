# @rote/cli

The `rote` command-line interface. It inspects recorded runs and launches recorded,
verified cold browser-agent tasks against local Chrome. The 0.1.0 package bundles internal
Rote workspaces into JavaScript, so consumers do not need the monorepo or a TypeScript
runtime. Later milestones add integrated replay selection, distillation, status, and diff
commands.

## Quickstart

Prerequisites: Node 20+, Chrome/Chromium, and one provider key. The scoped package is
prepared but not registry-published until npm scope ownership is confirmed; see
[T14](../../docs/testing/T14-cli-package-candidate.md).

```bash
export OPENAI_API_KEY=...
npx @rote/cli@0.1.0 run "Confirm that the page says Rote quickstart ready." \
  --url 'data:text/html,<h1>Rote quickstart ready</h1>' \
  --verify-text 'Rote quickstart ready' \
  --model gpt-4.1-mini --max-steps 3
```

The data URL is a safe local smoke (measured at one step and 366 input + 24 output tokens).
For real work, replace it with a page you are authorized to automate and a success signal that the live page—not the agent's
self-report—must show.

## Public API

- **`rote run <task> --url <url> (--verify-text <text> | --verify-url-contains <part>)`** — launches Chrome and prefers an exact-environment verified replay when `--replay-candidate <candidate.json>` is supplied; fingerprint mismatch short-circuits to the compact cold planner with a classified fallback. Optional: `--model`, `--max-steps`, `--chrome-path`, `--settle-timeout-ms`, and paired `--viewport-width`/`--viewport-height`.
- **`rote runs ls`** — lists every run under `.rote/runs`, one per line,
  with outcome and task spec. A run with no `manifest.json` yet (still in
  progress, or abandoned by a kill) is listed as `in-progress` rather than
  silently omitted.
- **`rote runs show <run_id>`** — prints the manifest plus every recorded
  `TrajectoryEvent` in order: tool, args, status, duration.
- `listRuns` / `showRun` (`src/runs.ts`) and `formatRunsList` /
  `formatRunDetail` (`src/format.ts`) are exported separately so formatting
  is unit-testable without spawning the CLI.

`ROTE_BASE_DIR` (default `.rote`) selects the run store. The cold path selects its
provider with `ROTE_LLM_PROVIDER=openai|anthropic` (default: `openai`) and reads the
matching `OPENAI_API_KEY` or `ANTHROPIC_API_KEY`. At least one explicit verification
condition is required; planner-declared success alone is never accepted. A matching
zero-LLM replay does not construct any provider client. Candidate paths are relative to
the candidate JSON file.

Create a candidate without calculating hashes by hand:

```bash
rote candidate create fixtures/playbooks/browser-b1-stateful.yaml \
  --url http://127.0.0.1:4321/b1-report.html \
  --params '{"username":"analyst","password":"secret"}' \
  --out .rote/candidates/b1-v1.json
```

The command validates the playbook, computes the environment fingerprint, stores a
portable relative playbook path, and refuses to overwrite an existing candidate.

Replay candidate format:

```json
{
  "playbook_path": "../../fixtures/playbooks/browser-b1-stateful.yaml",
  "fingerprint_hash": "<exact 64-character hash from the learned run>",
  "params": { "username": "analyst", "password": "secret" }
}
```

`base_url` is rebound from `--url` at execution time; all other params come from the
candidate. A mismatch never reaches replay.

## Known v1 limitations

- No integrated replay selection, distillation, or repair commands yet.
- V1 verification currently supports visible text and URL substring checks; richer live
  Expect DSL wiring lands with action-plane hardening.
- npm's unscoped `rote` name belongs to an unrelated package. The release candidate is
  `@rote/cli`; registry-backed `npx` remains blocked on scope ownership/authentication.
- Chrome/Chromium must already be installed or supplied with `--chrome-path`.

## Running tests

```bash
npm test --workspace @rote/cli
npm run test:package # build, pack, clean-install, and invoke the published bin shape
```
