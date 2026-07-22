# T6 — Exact WordPress benchmark corpus

| Field | Value |
|---|---|
| Date | 2026-07-22 |
| Protocol | `p1-g1-wordpress-v5-corpus`, WP-N10 |
| Provider/model | OpenAI / `gpt-4.1-mini` |
| Evidence | [Rote rows](data/T6-v5-rote-WP-N10.jsonl) · [Browser Use raw receipts](data/T6-v5-browser-use-WP-N10-raw.jsonl) · [normalized rows](data/T6-v5-browser-use-WP-N10.jsonl) |

## Finding and correction

The v4 WP-N10 smoke exposed WordPress's stock “Hello world!” post above the named
benchmark corpus. Browser Use selected that unrelated first checkbox in place of post 120,
and exact-title verification correctly failed. Seeding now force-deletes every non-corpus
post and fails unless the database contains exactly the 120 published titles numbered
001–120. `reset-state.sh` independently runs the same exact corpus gate.

The refreshed T2 probe remained byte-stable across 15 fresh sessions: 47,214 rendered
characters, approximately 11,804 tokens, and zero range. The first row is now post 120.

## Result

A fresh v5 WP-N10 pair passed exact-title verification:

| Harness | Provider calls | Outcome |
|---|---:|---:|
| Rote | 10 | success |
| Browser Use | 5 | success |

This is an instrument smoke, not comparison evidence. WP-N15/N20/N25 still require paired
v5 smokes before certification collection starts.
