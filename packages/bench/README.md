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
  that names recorded run ids, optional LLM usage sidecars, or explicit failed cells.
- **`readUsageSidecar`** — validates benchmark usage sidecars, rejecting untagged
  LLM calls before accounting.
- **`runCommandBenchmarkPlan`** — runs a human-authored command plan for real or
  frozen benchmark cells, validates each successful run wrote `.rote/runs`
  artifacts, and emits `bench-spec.json` for report/gate commands.
- **`writeSyntheticBenchmarkPack`** — writes deterministic fake B1–B3 artifacts
  (`.rote/runs`, usage sidecars, spec, report) so CI can exercise the full M3
  reporting pipeline before a live browser driver exists.
- **`evaluateM3Gate` / `renderM3GateResult`** — checks the M3 kill gate:
  warm-token reduction at or above threshold and no success-rate regression.
- **`rote-bench report <spec.json>`** — renders a Markdown report from recorded
  `.rote/runs/<run_id>` artifacts and can export raw JSONL alongside it.

## Spec format

```json
{
  "base_dir": ".rote",
  "runs": [
    { "task": { "id": "B1", "name": "download report" }, "phase": "cold", "repetition": 1, "run_id": "cold-b1-1", "usage_file": "usage/cold-b1-1.json" },
    { "task": { "id": "B1", "name": "download report" }, "phase": "warm", "repetition": 1, "run_id": "warm-b1-1", "usage_file": "usage/warm-b1-1.json" },
    { "task": { "id": "B2", "name": "vendor registration" }, "phase": "warm", "repetition": 2, "error": "fallback" }
  ]
}
```

```bash
rote-bench run bench-plan.json --out bench-out/
rote-bench report bench-out/bench-spec.json --out bench-out/report.md --export-jsonl bench-out/raw-runs/
rote-bench gate bench-out/bench-spec.json --min-token-reduction 0.8
```

## Command plan format

`rote-bench run` is the bridge to real/frozen B1–B3 runs. Each command should
invoke the baseline agent or replay executor while honoring the injected env:
`ROTE_RUN_ID`, `ROTE_BASE_DIR`, `ROTE_TASK_SPEC`, and `ROTE_USAGE_FILE`.

```json
{
  "runs": [
    {
      "task": { "id": "B1", "name": "download report" },
      "phase": "cold",
      "repetition": 1,
      "command": "./scripts/run-b1-cold.sh"
    },
    {
      "task": { "id": "B1", "name": "download report" },
      "phase": "warm",
      "repetition": 1,
      "command": "./scripts/run-b1-warm.sh"
    }
  ]
}
```

A command that exits non-zero becomes a failed benchmark cell. A command that
exits zero but does not write its run artifacts is also recorded as failed.

## Synthetic pack

```bash
rote-bench synthetic /tmp/rote-synthetic-bench
```

This creates a deterministic fake pack with B1–B3 cold and warm runs, matching
M3's illustrative economics (cold ≈ 40 calls / 200K tokens, warm ≈ 6 calls /
18K tokens). It is not evidence for the thesis; it is a fake-world regression
fixture that proves report generation, token accounting, sidecar loading, and
raw artifact layout work end to end before live benchmark drivers are added.

## Known v1 limitations

- Cache-adjusted baseline support is represented in the data model by phases and
  report comparisons, but the actual provider-cache control belongs to the live
  benchmark driver.
- Success parity is reported as counts; deciding whether a task artifact is
  semantically equivalent remains the injected driver's responsibility until the
  real B1–B3 demo environment exists.

## Serializer parity gate

`rote-bench serializer-report <spec.json>` compares Rote's full compact observation with
captured Browser Use model-facing text on identical HTML fixtures. `serializer-gate`
fails if any fixture is larger; reports label the shared `ceil(chars / 4)` token estimate
explicitly so it cannot be mistaken for provider billing.

## Running tests

```bash
npm test --workspace @rote/bench
```
