# P1 G1 curve protocol

This directory fixes the protocol for P1's headline graph: cumulative provider-reported
input tokens versus required browser interactions, Rote versus Browser Use, on the real
WordPress page selected in [T2](../../../docs/testing/T2-measurement-page-selection.md).
E1.2 defines the instrument; E1.3/E1.4 collect evidence with it.

## Fixed inputs

| Input | Value |
|---|---|
| Protocol | `p1-g1-wordpress-v6-accessible` (qualification only; long-cell redesign #92 pending) |
| Provider/model | OpenAI / `gpt-4.1-mini` |
| Harnesses | Rote and Browser Use |
| Repetitions | ≥15 per harness/checkpoint |
| Page | WordPress 6.8.2 Posts admin, 120 seeded posts, 100 rows/page |
| Reset | `wordpress/reset-state.sh` before every measured run |
| Viewport | 1920 × 1080 CSS px for both harnesses |
| Verification | exact trashed-title set via `wordpress/verify-trash-posts.sh` after every run |
| Model seed | unavailable; pin everything else and report variance |

Both harnesses receive the same rendered prompt, initial URL, page state, model, and
named post set from [`protocol.json`](protocol.json). Credentials are bound from the
local ignored WordPress `.env`; they are never written into protocol or result artifacts.
Run order must alternate harnesses within each checkpoint/repetition to prevent a provider
or host warm-up trend from belonging mostly to one side. Both harnesses block bulk Apply
unless the live selected-title set satisfies the protocol; WordPress's existing
screen-reader checkbox labels are mirrored onto `aria-label` so neither must infer row
identity from numeric DOM ids. T7 found that this makes N15 reachable but does not make the
current N20 bulk-checkbox task certifiable, so #92 must replace the long cells before
collection.

## Task-length checkpoints

The task signs in, checks *k* explicitly enumerated posts, confirms the live selected-name
ledger equals that set, chooses `Move to Trash`, applies once, and concludes. Rote's
pre-action guard rejects an incomplete or extra selection before the bulk side effect. Rote's closed one-action output therefore has a target of `k + 6` planner
calls: three login actions, *k* checkbox clicks, bulk select, apply, and done.

| Cell | Named posts (*k*) | Target planner calls | Why |
|---|---:|---:|---|
| WP-N07 | 1 | 7 | shortest honest authenticated flow; replaces the aspirational n≈5 |
| WP-N10 | 4 | 10 | short |
| WP-N15 | 9 | 15 | medium |
| WP-N20 | 14 | 20 | long |
| WP-N25 | 19 | 25 | longest |

The x-axis is **required interaction complexity**, fixed by *k*, not whichever harness
happens to use more internal calls. Every provider call is still recorded with its actual
`step_index`; retries remain visible and count toward spend. A run does not become a
success merely because it used the target number of calls: it must conclude and pass the
independent database verifier.

## Per-step JSONL contract

One line represents one provider call. Measurement rows require:

- protocol/task/harness/version/model/run/repetition identity;
- target and actual step index;
- source tag and duration in milliseconds, plus `duration_scope` (`provider_call` or enclosing `agent_step`);
- normalized uncached-input/cache-read/cache-write/output buckets;
- the provider's raw usage object, retained as the receipt;
- cumulative normalized buckets;
- optional action and observation mode/size;
- continued/success/failure plus final verification when known.

`input_tokens` always means the provider-normalized **uncached remainder** (#57).
The primary G1 logical-input curve uses:

```text
logical input = input_tokens + cache_read_tokens + cache_write_tokens
```

This prevents either provider's cache semantics from fabricating a token win: OpenAI's
inclusive input is split by subtraction, while Anthropic's optional path sums sibling
cache fields. A secondary cost curve prices the buckets separately; output tokens and
latency are separate panels.
Raw provider usage is mandatory so normalization can be audited against the provider's
own receipt.

`record_kind: "dry_run"` is explicitly non-evidentiary, has zero usage, and cannot enter
a launch graph. It exists only to prove protocol expansion and JSONL plumbing.

## Validate and dry-run

```bash
node packages/bench/bin/rote-bench.js curve-dry-run \
  scripts/bench/curve/protocol.json \
  --out bench-out/curve-dry-run.jsonl
wc -l bench-out/curve-dry-run.jsonl   # 77
```

The command validates checkpoint arithmetic and uniqueness, emits one placeholder row for
every target step, then parses the JSONL back through the same public schema before
writing it.

## Browser Use capture

The curve runner uses the same pinned Browser Use 0.13.6 dependency as the head-to-head
runner and audits both OpenAI and optional Anthropic receipt shapes. The canonical
`protocol.json` uses OpenAI and enumerates every long-cell target. V4 also states that
selected posts disappearing after Apply is expected completion evidence; the independent
verifier still decides final success. Superseded v5/v4/v3/v2 and the inaccessible Anthropic v1
pin are retained as provenance artifacts. Browser Use exposes provider receipts through its `TokenCost.usage_history`; the
runner maps every receipt timestamp to an enclosing agent step and fails if any receipt
is missing or unmapped. The independent database verifier replaces Browser Use's optional
LLM judge, so both harnesses use the same success rule without charging Browser Use for a
second, subjective grading call.

```bash
python3 -m venv /tmp/rote-browser-use
/tmp/rote-browser-use/bin/pip install -r scripts/bench/curve/browser-use/requirements.txt
scripts/bench/curve/wordpress/start.sh --reset
set -a; source .env; set +a    # OPENAI_API_KEY must be non-empty
/tmp/rote-browser-use/bin/python scripts/bench/curve/browser-use/run_curve.py \
  --out bench-out/curve/browser-use
```

For a non-publishable one-cell instrument probe, add `--checkpoint WP-N07
--repetitions 1`. The command writes both `browser-use-raw-calls.jsonl` (unaltered
Browser Use provider receipts) and `browser-use-curve.jsonl` (shared normalized rows).
Like the Rote runner, Browser Use refuses to overwrite non-empty evidence and supports
`--resume --max-new-runs 1`. Resume validates every existing run and fails on an
incomplete tail rather than risking a repeated side effect. `--repetition <n>` pins one
run id for paired collection.
If normalization needs to be repeated without another paid run:

```bash
node packages/bench/bin/rote-bench.js curve-browser-use-records \
  bench-out/curve/browser-use/browser-use-raw-calls.jsonl \
  --out bench-out/curve/browser-use/browser-use-curve.jsonl
```

Browser Use reports only enclosing agent-step duration, not provider-call latency. Its
measurement rows therefore use `duration_scope: "agent_step"`; Rote rows may use
`provider_call`. Actual provider-call `step_index` may exceed `target_steps` when a
harness retries—the target is interaction complexity, and retries must remain visible.
Credentials are passed through Browser Use's `sensitive_data` placeholders and are never
written into either artifact.

## Rote capture

Rote's runner uses the same reset, viewport, task prompt, model identity, and database
verifier. It retains each provider's raw usage receipt at the shared tagged-LLM boundary,
then emits validated cumulative rows directly:

```bash
set -a; source .env; set +a
node --import tsx/esm scripts/bench/curve/rote/run-curve.ts \
  --out bench-out/curve/rote.jsonl
```

Long collection is resumable and append-safe. Existing non-empty output is never
truncated: pass `--resume` to skip completed run ids, and optionally
`--max-new-runs 1` to execute one atomic browser session per invocation. Both harnesses
also accept `--repetition <n>` to target the same pair member exactly.

For certification, run one matched pair at a time. If the second harness fails before
recording, rerunning the command skips the already-completed first harness and retries the
same repetition rather than advancing it:

```bash
BROWSER_USE_PYTHON=/tmp/rote-browser-use/bin/python \
  scripts/bench/curve/run-next-pair.sh WP-N07 1
```

Repeat by checkpoint/repetition, preserving Rote → Browser Use alternation. Override
`ROTE_CURVE_OUT` and `BROWSER_USE_CURVE_OUT` if the default `bench-out/curve` paths are
not desired.

For a non-publishable one-cell test with a model other than the pinned model, pass one
`--checkpoint`, `--repetitions 1`, and `--openai-probe-model <model>`. The runner suffixes
the protocol id with `-openai-instrument-probe`, so those rows cannot be mistaken for
canonical comparison evidence.

## Oversized observation bootstrap

The selected page's full observation is ~47K characters, above the 4K ordinary budget.
[#67](https://github.com/kedarvartak/rote/issues/67) fixes the no-base case with one
explicit `bootstrap` observation under a separate 100,000-character hard ceiling; its
full size and budget overage are recorded and included in G1. The next small change is
rendered as an ordinary-budget diff. Above the emergency ceiling Rote fails before calling
the planner rather than asking it to invent selectors from a count-only summary.
