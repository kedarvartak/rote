# P1 G1 curve protocol

This directory fixes the protocol for P1's headline graph: cumulative provider-reported
input tokens versus required browser interactions, Rote versus Browser Use, on the real
WordPress page selected in [T2](../../../docs/testing/T2-measurement-page-selection.md).
E1.2 defines the instrument; E1.3/E1.4 collect evidence with it.

## Fixed inputs

| Input | Value |
|---|---|
| Protocol | `p1-g1-wordpress-v1` |
| Provider/model | Anthropic / `claude-opus-4-8` |
| Harnesses | Rote and Browser Use |
| Repetitions | ≥15 per harness/checkpoint |
| Page | WordPress 6.8.2 Posts admin, 120 seeded posts, 100 rows/page |
| Reset | `wordpress/reset-state.sh` before every measured run |
| Verification | database-level `wordpress/verify-trash-count.sh` after every run |
| Model seed | unavailable; pin everything else and report variance |

Both harnesses receive the same rendered prompt, initial URL, page state, model, and
named post set from [`protocol.json`](protocol.json). Credentials are bound from the
local ignored WordPress `.env`; they are never written into protocol or result artifacts.
Run order must alternate harnesses within each checkpoint/repetition to prevent a provider
or host warm-up trend from belonging mostly to one side.

## Task-length checkpoints

The task signs in, checks *k* named posts, chooses `Move to Trash`, applies once, and
concludes. Rote's closed one-action output therefore has a target of `k + 6` planner
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

- protocol/task/harness/model/run/repetition identity;
- target and actual step index;
- source tag and duration in milliseconds;
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

This avoids Anthropic's cached-input collapse fabricating a token win. A secondary cost
curve prices the three buckets separately; output tokens and latency are separate panels.
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

## Oversized observation bootstrap

The selected page's full observation is ~40K characters, above the 4K ordinary budget.
[#67](https://github.com/kedarvartak/rote/issues/67) fixes the no-base case with one
explicit `bootstrap` observation under a separate 100,000-character hard ceiling; its
full size and budget overage are recorded and included in G1. The next small change is
rendered as an ordinary-budget diff. Above the emergency ceiling Rote fails before calling
the planner rather than asking it to invent selectors from a count-only summary.
