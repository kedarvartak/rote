# T9 — Stop v7 certification; qualify safe tag creation

| Field | Value |
|---|---|
| Date | 2026-07-23 |
| Provider/model | OpenAI / `gpt-4.1-mini` |
| Stopped v7 evidence | [Rote](data/T9-v7-certification-stop-rote.jsonl) · [Browser Use raw](data/T9-v7-certification-stop-browser-use-raw.jsonl) · [normalized](data/T9-v7-certification-stop-browser-use.jsonl) |
| v8 qualification | [Rote](data/T9-v8-tag-qualification-rote.jsonl) · [Browser Use raw](data/T9-v8-tag-qualification-browser-use-raw.jsonl) · [normalized](data/T9-v8-tag-qualification-browser-use.jsonl) |

## Why certification stopped

The first v7 certification repetition failed 3 of 10 harness/cells. Rote WP-N08
concluded but failed exact database verification; Browser Use WP-N16 clicked the adjacent
**Move to Trash** control instead of Update and failed exact verification; Rote WP-N24
timed out at the settledness gate. Failed records remain in the denominator and raw
evidence. Collection stopped immediately rather than seeking 15 lucky successes.

The outcome invalidates T8's one-pair reliability inference. The verifier worked: neither
an agent's success report nor a visually plausible title was accepted when database state
disagreed.

## v8 workload

Canonical `p1-g1-wordpress-v8-tag-creation` still begins at the same large All Posts page.
After login, each checkpoint opens WordPress Tags and creates 1–5 deterministic tags one
at a time. Every tag has an exact name, slug, and description. The verifier requires the
exact tag set, zero post assignments, and the unchanged exact 120-post corpus.

This workflow contains no checkbox operation, title editor, destructive control, custom
Browser Use repair, or action guard. Reset deletes all post tags before restoring and
checking the corpus.

## Bounded qualification

Three independently reset paired repetitions passed at every cell (30/30 sessions):

| Cell | Tags | Target interactions | Rote calls | Browser Use calls | Exact results |
|---|---:|---:|---:|---:|---|
| WP-N09 | 1 | 9 | 9–10 | 4–5 | 3/3 each |
| WP-N13 | 2 | 13 | 13 | 5 | 3/3 each |
| WP-N17 | 3 | 17 | 17 | 6 | 3/3 each |
| WP-N21 | 4 | 21 | 21–22 | 7 | 3/3 each |
| WP-N25 | 5 | 25 | 25–26 | 8 | 3/3 each |

Retries remain measured. Target interactions describe fixed task complexity rather than a
harness's chosen provider-call batching.

## Decision

V7 is rejected for certification. V8 passes a stronger bounded qualification and may
start a new append-safe matrix from repetition 1. Qualification rows remain explicitly
non-comparative and do not count toward the required 15 successful certification runs per
harness/cell.
