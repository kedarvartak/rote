# @rotehq/cli

The `rote` command-line interface. It inspects recorded runs and launches recorded,
verified cold browser-agent tasks against local Chrome. The public 0.1.0 package bundles
internal Rote workspaces into JavaScript, so consumers do not need the monorepo or a
TypeScript runtime. The source workspace has advanced to 0.2.0-dev.0 for post-release
work; later milestones add distillation, status, and diff commands.

## Quickstart

Prerequisites: Node 20+, Chrome/Chromium, and one provider key. The package is public in
the maintainer-owned `rotehq` npm organization. Its registry bytes and provider-backed
empty-directory quickstart are frozen in
[T28](https://github.com/kedarvartak/rote/blob/main/docs/testing/T28-registry-provider-quickstart.md).

```bash
export OPENAI_API_KEY=...
npx @rotehq/cli@0.1.0 run "Confirm that the page says Rote quickstart ready." \
  --url 'data:text/html,<h1>Rote quickstart ready</h1>' \
  --verify-text 'Rote quickstart ready' \
  --model gpt-4.1-mini --max-steps 3
```

The data URL is a safe local smoke (measured at one step and 366 input + 24 output tokens).
For real work, replace it with a page you are authorized to automate and a success signal that the live page—not the agent's
self-report—must show. Clean agent failures retain `recall_unavailable`,
`verification_failed`, or `step_budget_exhausted` in CLI errors rather than collapsing
into an untyped summary.

A provider-backed cold→zero-token replay→selector-drift fallback demo is runnable from the
repository with `scripts/demo/run-launch-demo.sh`; see [T16](https://github.com/kedarvartak/rote/blob/main/docs/testing/T16-launch-demo.md).

## Public API

- **`rote run <task> --url <url> (--verify-text <text> | --verify-url-contains <part>)`** — launches Chrome and, unless `--replay-candidate <candidate.json>` names an explicit candidate, **consults the playbook library** (`.rote/playbooks`) through the matcher: fingerprint hard gate first, then a conservative intent/param match against the task text and `--params <json>`; a match replays with zero model calls (`selection: library match …`), a miss is classified (`selection: no library match (below_threshold|params_unbound|ambiguous|no_candidates|fingerprint_mismatch)`) and runs the compact cold planner. Fingerprint mismatch short-circuits to cold; failed or errored replay restarts cold from the pinned initial URL with a classified reason. On the cold path the environment's **site memory** is rendered as a hard-budgeted advisory brief into the planner's stable prefix (`--site-brief-chars <n>`, default 1200, `0` disables; empty memory renders nothing) and the output reports `site brief: <chars> chars, <used>/<hinted> hints used`. When earlier successful runs of the same task and environment exist, a shadow predictor built from them scores every planner step (`shadow predictor: <hits>/<steps> steps agreed`) — recorded, never dispatched. `--routine-model <model> [--route-min-confidence <0-1>]` routes steps the predictor is confident about to that cheaper model, with the frontier `--model` taking every other step, repair, and escalation (`routing: r routine / f frontier steps, e escalations`). Stored semantic identity can repair stale selectors before dispatch; output reports the repaired-step count. Optional: `--model`, `--max-steps`, `--chrome-path`, `--settle-timeout-ms`, and paired `--viewport-width`/`--viewport-height`.
- **`rote distill <run_id> --name <playbook> [--params <json name→value>] [--domain <domain>] [--literal-values fail|allow]`** — learns from one recorded *successful* run, no model call: distills a contract-gated, parameterized playbook whose `verify` is the declarative checks the run's verifier proved (`@rote/distiller`), adds it to the append-only library with the fingerprint it was proved on (`@rote/matcher`), and appends value-free site memory for that environment (`@rote/site-memory`). Prints what was kept/pruned, how `verify` was obtained, and how many memory records landed. Re-distilling the same name/version is refused; bump the version.
- **`rote continue <task_id> --playbook <playbook.yaml> --url <url> [--params <json>] [--principal <id>] [--stop-after <step_id>]`** — resumes (or starts) a controlled playbook run under a task id with append-only checkpoints after every step (`@rote/continuation`): a new browser process per session, the fixed-order resume gate (fingerprint → principal → task → procedure version → bindings → evidence → not completed) before any action, completed steps never dispatched again. A refused resume prints `continuation refused before any action [continuation_state_mismatch: <kind>]` and exits non-zero with nothing dispatched. `--evidence-oracle <url-template>` (with `{task_id}` substituted) binds an E7.4 fixture-oracle source into every checkpoint — its events and freshness generation are recorded, so a fixture reset or diverged authoritative state refuses the resume instead of replaying over it; `--evidence-run-id` overrides the evidence subject's run id (default: the task id). No credential handling (P4).
- **`rote runs ls`** — lists every run under `.rote/runs`, one per line,
  with outcome and task spec. A run with no `manifest.json` yet (still in
  progress, or abandoned by a kill) is listed as `in-progress` rather than
  silently omitted.
- **`rote playbooks`** — lists the learned playbook library value-free: name, version,
  step count, params, truncated fingerprint, and source run. Empty until a run is
  distilled.
- **`rote memory [fingerprint_hash] [--brief-chars <n>]`** — inspect tier-2 site
  memory. Without args: every partition with consolidated fact counts by kind. With a
  fingerprint: the consolidated facts (value-free — identities, digests, coded quirks,
  settle percentiles) and, with `--brief-chars`, the advisory brief exactly as a run
  would render it.
- **`rote predict-report`** — accumulates every recorded run's shadow predictions into
  the live calibration T39 requires before the predictor may act: overall and per-source
  hit rates, T39-shaped confidence buckets, and coverage/precision at the T39 acting
  thresholds. Pure read; an empty accumulator says so.
- **`rote report <run_id>`** — aggregates one recorded run into per-source token
  accounting (logical input = uncached + cache reads + cache writes, so caching cannot
  masquerade as savings), plus routing, shadow-predictor, and settle summaries. Pure
  read: any outcome, manifest-less runs included; a run that recorded nothing reports
  nothing.
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

The full launch contract is [known limitations](https://github.com/kedarvartak/rote/blob/main/docs/known-limitations.md).
In particular:

- No automatic matcher, distillation, arbitrary workflow repair, or repair-management commands yet; candidates are explicit and semantic healing is target-level only.
- V1 verification currently supports visible text and URL substring checks; richer live
  Expect DSL wiring lands with action-plane hardening.
- npm's unscoped `rote` name belongs to an unrelated package. Use the published
  `@rotehq/cli`; the immutable 0.1.0 tarball predates B4 and its bundled README retains
  candidate-era publication wording corrected by T28 and this tracked source.
- Chrome/Chromium must already be installed or supplied with `--chrome-path`.
- Cold fallback re-navigates the initial URL, but cannot generically undo server-side side
  effects made before a replay failure. Only use replay for workflows whose authored
  assertions and site reset semantics make retry safe.

## Running tests

```bash
npm test --workspace @rotehq/cli
npm run test:package # build, pack, clean-install, and invoke the published bin shape
```
