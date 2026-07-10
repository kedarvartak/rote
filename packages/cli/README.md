# @rote/cli

The `rote` command-line interface. It inspects recorded runs and launches recorded,
verified cold browser-agent tasks against local Chrome. Later milestones add integrated
replay selection, distillation, status, and diff commands.

## Public API

- **`rote run <task> --url <url> (--verify-text <text> | --verify-url-contains <part>)`** — launches Chrome, runs the compact tagged planner loop, waits for network/DOM settledness after actions, verifies completion, records the trajectory/manifest, and prints token usage. Optional: `--model`, `--max-steps`, `--chrome-path`, `--settle-timeout-ms`.
- **`rote runs ls`** — lists every run under `.rote/runs`, one per line,
  with outcome and task spec. A run with no `manifest.json` yet (still in
  progress, or abandoned by a kill) is listed as `in-progress` rather than
  silently omitted.
- **`rote runs show <run_id>`** — prints the manifest plus every recorded
  `TrajectoryEvent` in order: tool, args, status, duration.
- `listRuns` / `showRun` (`src/runs.ts`) and `formatRunsList` /
  `formatRunDetail` (`src/format.ts`) are exported separately so formatting
  is unit-testable without spawning the CLI.

`ROTE_BASE_DIR` (default `.rote`) selects the run store. `rote run` requires
`ANTHROPIC_API_KEY` and at least one explicit verification condition; planner-declared
success alone is never accepted.

## Known v1 limitations

- No integrated replay selection, distillation, or repair commands yet.
- V1 verification currently supports visible text and URL substring checks; richer live
  Expect DSL wiring lands with action-plane hardening.
- The `rote` bin relays into a `node --import tsx/esm` child for the same
  reason as `@rote/recorder`'s bin — see that package's README.

## Running tests

```bash
npm test --workspace @rote/cli
```
