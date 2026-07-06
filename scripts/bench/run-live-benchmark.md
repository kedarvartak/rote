# M3 live benchmark runbook

This runbook turns a real frozen browser-agent environment into the M3 report.
The harness is already built; the operator supplies commands that run the real
baseline agent for `cold` cells and Rote replay for `warm` cells.

## 0. Preconditions

- Use a pinned/frozen B1–B3 environment. Do not benchmark against a drifting dev
  portal.
- Each command must write standard Rote artifacts under the injected
  `ROTE_BASE_DIR`:
  - `.rote/runs/<ROTE_RUN_ID>/trajectory.jsonl`
  - `.rote/runs/<ROTE_RUN_ID>/manifest.json`
- Each command must write provider usage to the injected `ROTE_USAGE_FILE`.
  See `usage-sidecar.schema.json`.
- Cold commands should run the plain baseline agent through the Recorder.
- Warm commands should run replay using the hand-authored playbooks.

The command driver injects these env vars for every cell:

| Env var | Meaning |
|---|---|
| `ROTE_RUN_ID` | Stable run id expected by the benchmark spec |
| `ROTE_BASE_DIR` | Directory where `.rote/runs` artifacts must be written |
| `ROTE_TASK_SPEC` | Human-readable task spec for the manifest |
| `ROTE_BENCH_TASK` | `B1`, `B2`, or `B3` |
| `ROTE_BENCH_PHASE` | `cold`, `warm`, or `drift` |
| `ROTE_BENCH_REPETITION` | 1-based repetition index |
| `ROTE_USAGE_FILE` | Path where the command must write token usage JSON |

## 1. Create a live plan

```bash
cp scripts/bench/live-b1-b3-plan.example.json /tmp/rote-live-plan.json
$EDITOR /tmp/rote-live-plan.json
```

Replace every placeholder command with your real scripts. Use absolute paths so
benchmark runs are reproducible from any cwd.

Recommended first real matrix:

- B1/B2/B3 cold ×3
- B1/B2/B3 warm ×5

The example has one repetition per cell for readability; duplicate entries and
increment `repetition` to run the full matrix.

## 2. Command contract

A cold command should usually wrap the downstream MCP server with the Recorder:

```bash
ROTE_TARGET_IDENTITY=reports.acme.com \
  node packages/recorder/bin/rote-record.js <real-browser-mcp-command> <args...>
```

A warm command should usually run replay:

```bash
ROTE_DOWNSTREAM_COMMAND=<real-browser-mcp-command> \
ROTE_DOWNSTREAM_ARGS='["arg1", "arg2"]' \
ROTE_TARGET_IDENTITY=reports.acme.com \
  node packages/executor/bin/rote-replay.js fixtures/playbooks/b1-download-report.yaml \
  --params '{"username":"...","password":"..."}'
```

If a replay command writes a random executor run id instead of `ROTE_RUN_ID`, the
wrapper script must rename that run directory before exiting. See
`run-b1-warm.mjs` for the current smoke workaround.

## 3. Usage sidecars

The sidecar can be either a raw array:

```json
[
  { "source": "planner", "input_tokens": 123000, "output_tokens": 45000 }
]
```

or an object:

```json
{
  "token_usage": [
    { "source": "matcher", "input_tokens": 1200, "output_tokens": 200 },
    { "source": "verify", "input_tokens": 900, "output_tokens": 100 }
  ]
}
```

Allowed sources are:

`planner | matcher | slot | judgment | repair | verify | distill`

Untagged usage must not be reported; `rote-bench report` rejects invalid
sidecars through the same Zod schema used by the packages.

## 4. Run the benchmark

```bash
rm -rf /tmp/rote-live-bench
node packages/bench/bin/rote-bench.js run /tmp/rote-live-plan.json --out /tmp/rote-live-bench
node packages/bench/bin/rote-bench.js report /tmp/rote-live-bench/bench-spec.json \
  --out /tmp/rote-live-bench/report.md \
  --export-jsonl /tmp/rote-live-bench/raw-runs
node packages/bench/bin/rote-bench.js gate /tmp/rote-live-bench/bench-spec.json
```

## 5. Interpret the result

M3 passes only if `rote-bench gate` passes on B1–B3:

- warm token reduction ≥ 80%
- warm success rate ≥ cold success rate

A passing fake/smoke benchmark does **not** pass M3. Only real frozen B1–B3 runs
with real provider usage count.

If the gate fails:

- 50–80% token reduction: investigate executor/reporting overhead once, then
  re-run.
- <50% token reduction: stop and rethink the thesis per `docs/06-build-plan.md`.
- success regression: fix safety/replay correctness before measuring tokens.
