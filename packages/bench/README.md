# @rote/bench

Benchmark harness for M3: the "run it twice" economics gate from
`docs/03-wedge-benchmark.md` and `docs/06-build-plan.md`.

This package owns deterministic benchmark orchestration and reporting, not a
specific live agent integration. Callers inject a `BenchDriver` that runs either
the baseline agent (`cold`) or the replay executor (`warm`/`drift`); the harness
records every matrix cell, including driver failures, so failed runs cannot be
silently dropped from reports.

## Public API

See `src/index.ts`. Highlights:

- **`runBenchmarkMatrix`** — runs `{task × phase × repetition}` in deterministic
  order and converts driver exceptions into failed cells.
- **`summarizeTokenUsage` / `buildBenchReport`** — aggregates tagged provider
  usage from `RunManifest.token_usage`, tool-call counts from trajectories, and
  warm-vs-cold reduction ratios.
- **`renderMarkdownReport`** — renders a byte-stable Markdown report.
- **`readRecordedRun` / `exportSuccessfulTrajectories`** — reads standard
  `.rote/runs/<run_id>` artifacts and exports raw JSONL trajectories for the
  reproducibility pack.
- **`parseBenchmarkSpec` / `cellsFromSpec`** — loads a human-editable JSON spec
  that names recorded run ids or explicit failed cells.
- **`rote-bench report <spec.json>`** — renders a Markdown report from recorded
  `.rote/runs/<run_id>` artifacts and can export raw JSONL alongside it.

## Spec format

```json
{
  "base_dir": ".rote",
  "runs": [
    { "task": { "id": "B1", "name": "download report" }, "phase": "cold", "repetition": 1, "run_id": "cold-b1-1" },
    { "task": { "id": "B1", "name": "download report" }, "phase": "warm", "repetition": 1, "run_id": "warm-b1-1" },
    { "task": { "id": "B2", "name": "vendor registration" }, "phase": "warm", "repetition": 2, "error": "fallback" }
  ]
}
```

```bash
rote-bench report bench-spec.json --out report.md --export-jsonl raw-runs/
```

## Known v1 limitations

- Cache-adjusted baseline support is represented in the data model by phases and
  report comparisons, but the actual provider-cache control belongs to the live
  benchmark driver.
- Success parity is reported as counts; deciding whether a task artifact is
  semantically equivalent remains the injected driver's responsibility until the
  real B1–B3 demo environment exists.

## Running tests

```bash
npm test --workspace @rote/bench
```
