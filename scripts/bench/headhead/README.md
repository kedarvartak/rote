# Head-to-head: Rote vs Browser Use

This is the runbook for **the number** — end-to-end tokens per task at success
parity (`docs/05-roadmap.md` W5, `docs/03-benchmark.md` fairness
rules). The serializer gate proves per-observation parity; this proves the launch
claim on whole tasks.

## Why the layout looks like this

| File | Role |
|---|---|
| `tasks.json` | The **single source of truth** for what both harnesses are asked to do. Prompt, fixture page, and verification text per task. |
| `rote-plan.json` | The Rote side: a `rote-bench run` command plan whose prompts/URLs/verify text are checked against `tasks.json` by `packages/bench/test/browser-use-adapter.test.ts`. |
| `serve-fixtures.mjs` | Serves `fixtures/sites` on a fixed port so both harnesses hit byte-identical frozen pages. |
| `browser-use/run_browser_use.py` | The Browser Use side. Out-of-process (it is a Python library), imported as a dependency, never forked. Emits raw runs only. |

The Python runner does **not** write the neutral records. It emits raw per-run
rows; `rote-bench competitor-records` maps them, stamping fairness provenance
(`model`, `cache_adjusted`, `config_notes`) in-repo where it is reviewable, so
every adapter is held to the same mapping.

## 0. Preconditions

- Credentials and Chrome path configured — copy `.env.example` to `.env`, fill it
  in, then `set -a; source .env; set +a` (nothing auto-loads `.env`).
- Python ≥ 3.11 for the competitor runner.
- **Same model on both sides.** `tasks.json`'s `model` is the single source of
  truth: `rote-plan.json` pins it with `--model` (a test asserts they agree), and
  you pass the same value to the Python runner's `--model`. Do not rely on either
  harness's default — an unpinned run silently uses the SDK default while the
  records still declare the model you wrote in `sources.json`.
- Decide honestly whether the counts are cache-adjusted (see *Cache adjustment*).

## 1. Serve the frozen fixtures

```bash
node scripts/bench/headhead/serve-fixtures.mjs 8080
```

## 2. Collect matched attempts atomically

Install the pinned Browser Use dependency once, then execute one exact pair at a time:

```bash
python3 -m venv /tmp/rote-browser-use
/tmp/rote-browser-use/bin/pip install -r scripts/bench/headhead/browser-use/requirements.txt
set -a; source .env; set +a

BROWSER_USE_PYTHON=/tmp/rote-browser-use/bin/python \
  scripts/bench/headhead/run-next-pair.sh B1 1
```

Repeat B1–B3 for repetitions 1–18, with repetition outermost and task order B1→B3.
Each invocation runs Rote then Browser Use, durably records each completed attempt, and
is safe to rerun: `--resume` skips an exact completed task/repetition rather than
success-hunting. Rote retains standard `.rote` manifests plus neutral raw rows; Browser
Use retains `raw-runs.json` plus per-attempt diagnostics.

Both harnesses start at the same URL through unmeasured navigation and use the pinned
1920×1080 viewport. Browser Use is `browser-use==0.13.6`, imported as a dependency with
its default agent behavior—never forked or patched.

This writes `raw-runs.json` plus a per-run dump under `raw/` (usage, visited
URLs, errors, final result, and the installed browser-use version). Publish
`raw/` with the report — `docs/03`: "publish raw JSONL + analysis. Credibility in
this space comes from reproducibility."

`raw-runs.example.json` shows the emitted shape and is what CI ingests; it is an
illustrative example, **not** a real capture and not evidence of anything.

## 3. Map both raw files to neutral records

```bash
node packages/bench/bin/rote-bench.js competitor-records bench-out/g2/rote/raw-runs.json \
  --harness rote --model gpt-4.1-mini --cache-adjusted true \
  --config-notes "Rote current main, exact provider cache buckets, 1920x1080" \
  --out bench-out/g2/rote.json

node packages/bench/bin/rote-bench.js competitor-records bench-out/g2/browser-use/raw-runs.json \
  --harness browser-use --model gpt-4.1-mini --cache-adjusted true \
  --config-notes "browser-use 0.13.6, defaults, exact provider cache buckets, max_steps=25, 1920x1080" \
  --out bench-out/g2/browser-use.json
```

`cache-adjusted=true` is valid only because both raw shapes contain measured uncached,
cache-read, and cache-write buckets. The gate now rejects `false`; a provenance boolean
without bucket evidence cannot certify G2.

## 4. Assemble and run the gate

```bash
cat > bench-out/g2/sources.json <<'JSON'
{
  "subject": { "harness": "rote", "records": "rote.json" },
  "competitors": [{ "harness": "browser-use", "records": "browser-use.json" }]
}
JSON

node packages/bench/bin/rote-bench.js records bench-out/g2/sources.json --out bench-out/g2/records.json
node packages/bench/bin/rote-bench.js headhead bench-out/g2/records.json --subject rote --out bench-out/g2/headhead.md
node packages/bench/bin/rote-bench.js launch-gate bench-out/g2/records.json --subject rote --min-runs 15
```

The gate passes only at success parity, with ≥15 successful runs per harness, and
a bootstrap confidence range whose **lower bound** clears the floor. The publishable
claim is that lower bound, not the mean.

## Grading (what counts as a success)

Browser Use is graded by exactly the rule Rote applies to itself: a run succeeds
only if the agent concluded it was done **and** the live page shows the same
`verify_text` that Rote's run must see. Taking the agent's word for it would hold
the competitor to a looser standard than Rote, and the success-parity check — the
only thing stopping Rote from "winning" by being cheap and wrong — would stop
meaning anything.

Every non-success outcome stays in the success-rate denominator, so the runner
refuses to grade a run it could not verify (an unreadable page is *our* probe's
bug, and scoring it would quietly cost the competitor success rate). Both signals
are also written to `raw/<id>.json` separately (`is_successful` and
`verify_text_visible`), so any grading decision can be re-checked against the raw
data rather than taken on trust.

## Cache adjustment

Token intervals use logical totals: uncached input + cache reads + cache writes + output.
Dollars use the dated model-specific rate for each bucket. This prevents provider caching
from looking like memory reduction while still reporting what each run actually costs.
Missing receipts or an impossible bucket split fail before a row is written.

## Honest-loss reporting

Report what the runner produces, including runs where Browser Use wins or where
Rote's cold runs are no cheaper. `docs/03` names the honest-loss scenarios
(one-shot tasks, high-drift surfaces, creative tasks); the launch package must
show them rather than only the favourable cells.
