# @rote/cli

The `rote` command-line interface. M1 ships the read-only slice:
inspecting what the recorder captured. Later milestones add `rote replay`,
`rote distill`, `rote status`, and `rote diff` (see `docs/06-build-plan.md`).

## Public API

- **`rote runs ls`** — lists every run under `.rote/runs`, one per line,
  with outcome and task spec. A run with no `manifest.json` yet (still in
  progress, or abandoned by a kill) is listed as `in-progress` rather than
  silently omitted.
- **`rote runs show <run_id>`** — prints the manifest plus every recorded
  `TrajectoryEvent` in order: tool, args, status, duration.
- `listRuns` / `showRun` (`src/runs.ts`) and `formatRunsList` /
  `formatRunDetail` (`src/format.ts`) are exported separately so formatting
  is unit-testable without spawning the CLI.

`ROTE_BASE_DIR` (default `.rote`) selects which run store to read.

## Known v1 limitations

- Read-only: no `replay`/`distill`/`repair` commands yet — those land with
  their respective milestones.
- The `rote` bin relays into a `node --import tsx/esm` child for the same
  reason as `@rote/recorder`'s bin — see that package's README.

## Running tests

```bash
npm test --workspace @rote/cli
```
