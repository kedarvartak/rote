# T8 — Title-review curve workload qualification

> **Superseded:** [T9](T9-certification-stop-and-tag-qualification.md) records 3/10
> failures in the first certification repetition. V7 is rejected; its one-pair inference
> below must not be used as reliability or comparison evidence.

| Field | Value |
|---|---|
| Date | 2026-07-22 |
| Protocol | `p1-g1-wordpress-v7-title-reviews` |
| Provider/model | OpenAI / `gpt-4.1-mini` |
| Evidence | [Rote](data/T8-v7-title-review-rote.jsonl) · [Browser Use raw](data/T8-v7-title-review-browser-use-raw.jsonl) · [Browser Use normalized](data/T8-v7-title-review-browser-use.jsonl) |

## Workload

Starting from the same real WordPress Posts page, each checkpoint edits 1–5 named posts
one at a time. Each operation opens the post, changes only its title by appending
`— reviewed`, updates, and returns to All Posts. The database verifier checks all 120
titles, contents, and statuses, so an extra edit or collateral content/status change fails.
No checkbox guard or custom Browser Use repair participates.

## Qualification result

| Cell | Reviewed posts | Target interactions | Rote calls | Browser Use calls | Exact verification |
|---|---:|---:|---:|---:|---|
| WP-N08 | 1 | 8 | 8 | 6 | both pass |
| WP-N12 | 2 | 12 | 12 | 8 | both pass |
| WP-N16 | 3 | 16 | 18 | 13 | both pass |
| WP-N20 | 4 | 20 | 20 | 14 | both pass |
| WP-N24 | 5 | 24 | 25 | 17 | both pass |

A bounded ten-step retry allowance remains visible in actual provider calls; it does not
change target interaction complexity. Explicit target cardinality prevents either planner
from inferring an unrequested numeric continuation.

The capture-proven selector fix makes links without HTML ids safely dispatchable and resets
A4's diff base on URL changes. The resulting fully actionable Posts observation is 89,114
characters (~22,279 approximate tokens), identical across 15 fresh sessions and below the
100,000-character grounded-bootstrap ceiling.

## Decision

The title-review workload qualifies for certification collection. These five one-pair
smokes are instrument evidence only; they are not the comparison graph. E1.4 may now
collect at least 15 successful runs per harness/cell using append-safe paired repetitions.
