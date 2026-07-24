# T12 — G2 B1–B3 instrument smoke

| Field | Value |
|---|---|
| Date | 2026-07-24 |
| Protocol | `p1-g2-fixtures-v1-b1-b3` |
| Provider/model | OpenAI / `gpt-4.1-mini` |
| Harnesses | Rote / Browser Use 0.13.6 |
| Rote evidence | [raw rows](data/T12-g2-instrument-rote-raw.json) · [manifests](data/T12-g2-instrument-rote-manifests.json) · [trajectories](data/T12-g2-instrument-rote-trajectories.jsonl) |
| Browser Use evidence | [raw rows](data/T12-g2-instrument-browser-use-raw.json) · [diagnostic dumps + provider receipts](data/T12-g2-instrument-browser-use-dumps.json) |

## Scope decision

G2 is frozen to the three already-built deterministic fixtures before certification:
B1 authenticated report download, B2 long vendor form, and B3 catalog search/open. B5
drift remains the first post-G2 trust instrument. Building B5 after seeing G1 would mix
new benchmark implementation with the level gate being judged.

## Instrument corrections

The old head-to-head path was not safe to collect:

- Rote neutralization dropped `cache_read_tokens` and `cache_write_tokens`.
- Browser Use exposed only one inclusive input total, so `cache_adjusted: true` was an
  assertion without evidence.
- Runs were harness-blocked rather than alternated, Browser Use interpreted the initial
  URL from task prose, viewport parity was absent, and collection overwrote on restart.
- Browser Use's old final-page accessor did not work on pinned 0.13.6.

The v1 instrument now records uncached/read/write/output buckets, uses logical totals for
the token gate and model-specific buckets for cost, rejects unadjusted or model-mismatched
gates, pre-navigates both harnesses, fixes 1920×1080, verifies Browser Use against live CDP
text before teardown, and executes one append-safe exact Rote→Browser Use pair at a time.

## Smoke result

| Task | Rote logical input | Browser Use logical input | Rote output | Browser Use output | Exact result |
|---|---:|---:|---:|---:|---|
| B1 | 2,661 | 33,921 | 180 | 736 | both pass |
| B2 | 7,840 | 34,639 | 389 | 1,026 | both pass |
| B3 | 1,987 | 33,954 | 132 | 690 | both pass |

All six sessions concluded and showed the same fixture verification text. Raw Browser Use
provider receipts are retained in each diagnostic dump; missing receipts fail rather than
record zero.

## Decision

The B1–B3 G2 instrument is ready for repetition-outer, B1→B3, Rote→Browser Use collection.
These six rows are instrument evidence only and do not count toward the ≥15-success/cell
certification matrix. No level claim is made from one repetition.
