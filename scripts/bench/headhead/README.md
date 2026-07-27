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
| `run-certification.sh` | One resumable command: fixture server, 18×B1–B3 paired collection, neutralization, audit, gate, Markdown, and JSON. |
| `assemble-certification-evidence.mjs` | Cross-run manifest/trajectory/dump assembly; refuses count mismatches before reporting. |

> **B2 correction:** protocol v2 requires one terminal DOM string containing all eight
> requested values. T13's completion-only B2 claim is withdrawn; see
> [T19](../../../docs/testing/T19-b2-exact-verification.md). Do not run B5 against v1.

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

## 1. Install the pinned competitor once

```bash
python3 -m venv /tmp/rote-browser-use
/tmp/rote-browser-use/bin/pip install -r scripts/bench/headhead/browser-use/requirements.txt
set -a; source .env; set +a
```

## 2. Collect, audit, and report in one command

```bash
BROWSER_USE_PYTHON=/tmp/rote-browser-use/bin/python \
  scripts/bench/headhead/run-certification.sh
```

The command starts the frozen fixture server, runs repetitions 1–18 with repetition
outermost and B1→B3 task order, preserves Rote→Browser Use ordering in every pair,
assembles raw manifests/trajectories/dumps, neutralizes both harnesses, executes the gate,
and writes audited Markdown plus JSON under `bench-out/g2-certification/evidence/`.

Collection remains atomic and resumable. Re-running the same command skips exact completed
attempts rather than replacing them or success-hunting; incomplete append-only tails still
fail for operator review. Override only the output location with `G2_OUT`. A repetition
count below 15 is rejected because it cannot certify G2.

Both harnesses start at the same URL through unmeasured navigation and use 1920×1080.
Browser Use is `browser-use==0.13.6`, imported with default agent behavior—never forked or
patched. `cache_adjusted=true` is emitted only from measured uncached/read/write buckets.
Missing receipts, model mismatch, evidence-count mismatch, failed parity, or a nonpositive
interval fails the command.

`raw-runs.example.json` is illustrative, **not** evidence. A complete paid run retains
`raw-runs.json`, every Browser Use diagnostic dump, every Rote manifest/trajectory, neutral
records, gate output, report, and machine summary.

## 3. Reproduce the published result without a provider call

```bash
npm ci
npm run reproduce:g2
```

This re-audits the downloadable T13 raw evidence and requires regenerated Markdown and
JSON to match the committed report byte-for-byte. The gate passes only at success parity,
with ≥15 successful runs per harness and a bootstrap lower bound above the floor; the
claim is the interval, not just the mean.

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
