# @rote/bench

Benchmark harness for M3: the "run it twice" economics gate from
`docs/03-benchmark.md` and `docs/05-roadmap.md`.

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
- **`CurveProtocolSchema` / `CurveStepRecordSchema`** — validate P1 G1's real-page task checkpoints and per-provider-call JSONL, including all normalized cache buckets plus the raw provider receipt.
- **`rote-bench curve-dry-run <protocol.json> --out <records.jsonl>`** — expands every checkpoint into explicitly non-evidentiary zero-usage rows and parses them back before writing, proving the protocol/JSONL plumbing without fabricating a benchmark result.
- **`parseBrowserUseCurveRawJsonl` / `browserUseCurveRecordsFromRaw`** — retain and validate every Browser Use provider receipt, then normalize its Anthropic/OpenAI uncached/read/write/output buckets and cumulative totals into shared curve records.
- **`rote-bench curve-browser-use-records <raw-calls.jsonl> --out <records.jsonl>`** — converts the external Python runner's raw receipts into validated measurement JSONL, failing on missing calls, impossible cache accounting, or unverifiable final outcomes.
- **`roteCurveRecordsFromRun` / `renderRoteCurveRun`** — emit Rote's matching per-provider-call rows from an agent run, requiring one raw receipt per normalized usage and preserving observation/action/verification evidence.
- **`planCurveResume`** — validates existing curve JSONL, refuses non-empty overwrite, and returns only fully completed run ids for append-safe one-run batching.
- **`buildCurveCachePreflight` / `rote-bench curve-cache-preflight`** — report prompt-size eligibility and provider-observed cache hits from raw curve calls, separating “layout work can fire” from “layout is qualified.”

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

### Producing ≥15 Rote runs per task (repetition fan-out)

The head-to-head launch gate needs ≥15 successful runs per harness (`--min-runs`).
Rather than hand-author one plan entry per repetition, give an entry
`repetitions: N` instead of `repetition`: it expands to N runs with `repetition`
1..N and auto-derived ids (`<task>-<phase>-<rep>`). The command is a real
`rote run`, which honors `ROTE_RUN_ID` and `ROTE_BASE_DIR` (set by the driver) and
writes a self-describing manifest with `token_usage` — no usage sidecar needed.

Start the frozen fixture server first (exported as `FixtureSiteServer` from
`@rote/browser`), then run one plan:

```json
{
  "runs": [
    {
      "task": { "id": "B1", "name": "download report" },
      "phase": "cold",
      "command": "rote",
      "args": ["run", "B1: download the latest report", "--url", "http://localhost:8080/b1", "--verify-text", "Download complete"],
      "repetitions": 18
    }
  ]
}
```

```bash
rote-bench run headhead-plan.json --out bench-out/            # 18 recorded runs -> bench-spec.json
# then reference bench-out/bench-spec.json as the subject.spec in sources.json:
rote-bench records sources.json --out bench-out/records.json
rote-bench launch-gate bench-out/records.json --min-runs 15
```

A failed repetition is retained as a failed cell (never dropped), so a flaky run
lowers the success rate the parity gate reads instead of silently vanishing.

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
(`docs/05-roadmap.md` W5). Both harnesses' runs are expressed as a
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

The report is the docs/05 W5 **G1 report**: tokens, latency, and $ per task. It
renders a reductions table (tokens / latency / $ at the reported parity) plus a
per-harness detail table (runs, success rate, avg tokens, avg/p50/p95 latency in
ms, $/task). $ comes from a dated, overridable price table (`--prices`); an
**unpriced model is labeled `price unavailable`, never $0** — a zero would read
as "free" and quietly flatter whichever harness lacks a price. The launch *gate*
stays token-based; latency and $ are reported, not gated, in V1 (docs/05 P3).

- **`readCompetitorRecords`** — loads a records file (bare array or `{ records }`).
- **`buildHeadToHead` / `renderHeadToHeadReport`** — per-task subject-vs-baseline
  economics: token/latency/$ reductions, latency percentiles, and success parity.
- **`DEFAULT_PRICE_TABLE` / `priceForModel` / `runCostUsd` / `readPriceTable`** —
  the dated price table (captured 2026-07-15) and pure cost arithmetic.
- **`mean` / `percentile` / `reduction`** (`stats.ts`) — pure, shared by the
  aggregation and the gate's bootstrap.
- **`bootstrapReductionInterval`** — pure, deterministic (fixed seed) reduction
  point estimate plus confidence range from each harness's per-run token totals.
- **`evaluateLaunchGate`** — the W5 gate: a comparison passes only at success
  parity, with enough successful runs, and a range lower bound at/above the floor.

```bash
rote-bench records sources.json --out bench-out/records.json
rote-bench headhead bench-out/records.json --subject rote --prices prices.json --out bench-out/headhead.md
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
- **`readCompetitorRawRuns` / `competitorRecordsFromRaw`** — the adapter contract:
  loads a competitor's minimal per-run output (`task`, `outcome`, tokens,
  `duration_ms`) and maps it onto neutral records with fairness provenance
  attached in-repo, not per adapter. Exposed as `rote-bench competitor-records`,
  whose `--harness`/`--model`/`--cache-adjusted` are required with no defaults so
  un-adjusted counts cannot be compared without it showing in the record.

```bash
rote-bench competitor-records raw-runs.json --harness browser-use --model gpt-4.1-mini \
  --cache-adjusted true --config-notes "browser-use 0.13.4, defaults" --out browser-use.json
```

The Browser Use runner that produces `raw-runs.json` is out-of-process (it is a
Python library) and lives in [`scripts/bench/headhead/`](../../scripts/bench/headhead/README.md),
which is the full runbook for the W5 number.

```json
{
  "subject": { "spec": "bench-spec.json", "model": "gpt-4.1-mini", "cache_adjusted": true },
  "competitors": [{ "harness": "browser-use", "records": "browser-use.json" }]
}
```

To get a trustworthy range, run each task ≥15 times per harness (the gate's
default `--min-runs`): populate `bench-spec.json` with that many recorded Rote
repetitions and emit the matching number of competitor runs into the sidecar.

```json
[
  { "harness": "rote", "task": "B1", "phase": "warm", "repetition": 0, "outcome": "success", "input_tokens": 100, "output_tokens": 20, "duration_ms": 900, "model": "gpt-4.1-mini", "cache_adjusted": true },
  { "harness": "browser-use", "task": "B1", "phase": "cold", "repetition": 0, "outcome": "success", "input_tokens": 420, "output_tokens": 60, "duration_ms": 2100, "model": "gpt-4.1-mini", "cache_adjusted": true, "config_notes": "default DOM serializer" }
]
```

## Running tests

```bash
npm test --workspace @rote/bench
```
