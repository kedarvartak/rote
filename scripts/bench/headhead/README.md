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

## 2. Run the Rote side (18 recorded runs per task)

```bash
node packages/bench/bin/rote-bench.js run scripts/bench/headhead/rote-plan.json --out bench-out/rote
```

`rote run` honors the driver's `ROTE_RUN_ID`/`ROTE_BASE_DIR` and writes a
self-describing manifest with tagged `token_usage`, so there is no usage sidecar
on this side — the totals are summed from recorded artifacts, never hand-typed.

## 3. Run the Browser Use side

```bash
cd scripts/bench/headhead/browser-use
pip install -r requirements.txt
python run_browser_use.py --out ../../../../bench-out/browser-use
```

`--model` defaults to the model `tasks.json` pins for **both** harnesses, and
`--provider` defaults to `ROTE_LLM_PROVIDER` from your `.env` — so passing
nothing is the fair thing. Browser Use is a pinned dependency
(`browser-use==0.13.4`), never a fork or a vendored copy: `docs/05`'s launch
checklist requires that adapters "import competitors as dependencies, not forks",
and a fork we control is a fork we could tune.

This writes `raw-runs.json` plus a per-run dump under `raw/` (usage, visited
URLs, errors, final result, and the installed browser-use version). Publish
`raw/` with the report — `docs/03`: "publish raw JSONL + analysis. Credibility in
this space comes from reproducibility."

`raw-runs.example.json` shows the emitted shape and is what CI ingests; it is an
illustrative example, **not** a real capture and not evidence of anything.

## 4. Map raw runs to a competitor sidecar

```bash
node packages/bench/bin/rote-bench.js competitor-records bench-out/browser-use/raw-runs.json \
  --harness browser-use \
  --model "$(python3 -c 'import json;print(json.load(open("scripts/bench/headhead/tasks.json"))["model"])')" \
  --cache-adjusted true \
  --config-notes "browser-use 0.13.4, default DOM serializer, max_steps=25" \
  --out bench-out/browser-use.json
```

`--harness`, `--model` and `--cache-adjusted` have no defaults on purpose: a
defaulted `cache_adjusted` would let un-adjusted counts be compared without it
showing in the record.

## 5. Assemble and run the gate

```bash
cat > bench-out/sources.json <<'JSON'
{
  "subject": { "spec": "rote/bench-spec.json", "model": "claude-opus-4-8", "cache_adjusted": true },
  "competitors": [{ "harness": "browser-use", "records": "browser-use.json" }]
}
JSON

node packages/bench/bin/rote-bench.js records bench-out/sources.json --out bench-out/records.json
node packages/bench/bin/rote-bench.js headhead bench-out/records.json --subject rote --out bench-out/headhead.md
node packages/bench/bin/rote-bench.js launch-gate bench-out/records.json --subject rote --min-runs 15
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

`docs/03`: "agents get mildly cheaper on rerun via prompt caching alone — we must
beat that honestly, and report cache-adjusted numbers." Both harnesses run each
task ~18× against the same pages, so provider prompt caching will make later
repetitions cheaper on **both** sides. Set `--cache-adjusted true` only if the
counts you report are the tokens actually billed (cache reads counted at their
real rate), and say which in `--config-notes`. If you cannot tell, report `false`
and say so — a `false` on both sides is still a fair comparison; a wrong `true` is
a false claim.

## Honest-loss reporting

Report what the runner produces, including runs where Browser Use wins or where
Rote's cold runs are no cheaper. `docs/03` names the honest-loss scenarios
(one-shot tasks, high-drift surfaces, creative tasks); the launch package must
show them rather than only the favourable cells.
