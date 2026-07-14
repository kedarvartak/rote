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

## Head-to-head competitor gate

The serializer gate proves per-observation parity; the head-to-head gate proves
the launch claim end-to-end — *tokens per whole task, at success parity*
(`docs/17-v1-launch-plan.md` W5). Both harnesses' runs are expressed as a
harness-neutral `CompetitorRunRecord` (Rote's per-source `token_usage[]` is
summed into one total by `roteRecordsFromCells`; competitors report their own
lump total). Records carry fairness provenance — `model`, `cache_adjusted`,
`config_notes` — so the published number is auditable (`docs/03` fairness rules).

Because a single agent run is noisy (retries move the token count), the launch
gate does **not** trust one run or even a mean — it runs each task many times
(≥15/harness by default) and reports the reduction as a **confidence range** from
a seeded bootstrap. The gate passes only when the range's *lower bound* clears the
floor: a conservative, publishable claim like *"38% fewer tokens (95% CI:
31–44%)"*. Fewer than the minimum runs → the win is not certifiable, by design.

- **`readCompetitorRecords`** — loads a records file (bare array or `{ records }`).
- **`buildHeadToHead` / `renderHeadToHeadReport`** — per-task subject-vs-baseline
  economics with mean token reduction and success parity.
- **`bootstrapReductionInterval`** — pure, deterministic (fixed seed) reduction
  point estimate plus confidence range from each harness's per-run token totals.
- **`evaluateLaunchGate`** — the W5 gate: a comparison passes only at success
  parity, with enough successful runs, and a range lower bound at/above the floor.

```bash
rote-bench records sources.json --out bench-out/records.json
rote-bench headhead bench-out/records.json --subject rote --out bench-out/headhead.md
rote-bench launch-gate bench-out/records.json --subject rote --min-token-reduction 0.3 --min-runs 15
```

### Assembling records from real runs

The records file is not hand-authored. `rote-bench records <sources.json>` builds
it: the subject (Rote) side reads the standard `.rote/runs/<run_id>` artifacts
that `rote run` already writes — via an ordinary benchmark spec — and sums their
tagged manifest usage into one neutral total per run. Each competitor side is a
sidecar the external harness emits; running Browser Use / Stagehand is
out-of-process, and the sidecar is the fair hand-off (`docs/03` "publish adapters
+ configs + raw data"). The assembler fails loudly if a sidecar's `harness` label
disagrees with the source spec, so a mislabeled file can never be ranked as the
wrong competitor.

- **`assembleHeadToHeadRecords`** — merges recorded Rote runs + competitor
  sidecars into the neutral records the gate consumes.
- **`competitorRecordsFromRaw`** — the adapter contract: maps a competitor's
  minimal per-run output (`task`, `outcome`, tokens, `duration_ms`) onto neutral
  records with fairness provenance attached in-repo, not per adapter.

```json
{
  "subject": { "spec": "bench-spec.json", "model": "claude-opus-4-8", "cache_adjusted": true },
  "competitors": [{ "harness": "browser-use", "records": "browser-use.json" }]
}
```

To get a trustworthy range, run each task ≥15 times per harness (the gate's
default `--min-runs`): populate `bench-spec.json` with that many recorded Rote
repetitions and emit the matching number of competitor runs into the sidecar.

```json
[
  { "harness": "rote", "task": "B1", "phase": "warm", "repetition": 0, "outcome": "success", "input_tokens": 100, "output_tokens": 20, "duration_ms": 900, "model": "claude-opus-4-8", "cache_adjusted": true },
  { "harness": "browser-use", "task": "B1", "phase": "cold", "repetition": 0, "outcome": "success", "input_tokens": 420, "output_tokens": 60, "duration_ms": 2100, "model": "claude-opus-4-8", "cache_adjusted": true, "config_notes": "default DOM serializer" }
]
```

## Running tests

```bash
npm test --workspace @rote/bench
```
