# T2 — P1 measurement-page selection

**Date:** 2026-07-17  
**Task:** [07 E1.1](../07-execution-plan.md#e1--the-curve-gate-g1-67-days)  
**Outcome:** select a digest-pinned, self-hosted WordPress administration portal

## Decision

Use the real **WordPress 6.8.2 Posts administration page** with 120 deterministic seeded
posts and the table configured to show 100 rows:

```text
http://127.0.0.1:18081/wp-admin/edit.php
```

The reproducible environment lives in
[`scripts/bench/curve/wordpress/`](../../scripts/bench/curve/wordpress/). It is local-only,
requires no third-party account, has no Terms-of-Service automation risk, and can be reset
between repetitions. WordPress is GPL-2.0-or-later; Rote pulls official images as an
external benchmark dependency and does not vendor or fork its source.

## Why self-hosted, not a public site

A public page cannot satisfy the gate's stability contract: content, experiments, consent
banners, rate limits, and anti-bot responses can change between the ≥15 runs and move the
curve independently of either harness. It also makes exact ground-truth reset impossible.
A self-hosted production application gives us a real, non-fixture DOM while preserving a
byte-controlled database and authorized automation.

The existing B1–B3 pages were rejected because their distilled observations are about 537
characters—too small to trigger A4 diffing or any provider cache minimum. A synthetic
large fixture would fix size but fail G1's “real page” requirement. WordPress satisfies
both constraints.

## Reproduction

```bash
scripts/bench/curve/wordpress/start.sh --reset
node --import tsx/esm scripts/bench/curve/wordpress/probe-observation.mjs 15 \
  > observation-stability.json
```

Pinned images used by the checked-in Compose file:

| Component | Version | OCI digest |
|---|---:|---|
| WordPress Apache | 6.8.2, PHP 8.3 | `sha256:09ac1315368f234db7559e4f9dcca3178a5efc6f2193b88289252abe18551522` |
| WP-CLI | 2.12.0, PHP 8.3 | `sha256:f8aeb68164c6a04f5dcc91da30d8ffa096b0f7fafb7a65f144c2dd62587caca0` |
| MariaDB | 11.4.12 | `sha256:a794d9eb009e20de605858a11f32f63b4075cbd197c650436f0e3b457e4caed7` |

The raw probe output is checked in at
[`data/T2-wordpress-observation-stability.json`](data/T2-wordpress-observation-stability.json).
The token estimate in this test is explicitly approximate (`ceil(characters / 4)`); E1.4
will collect provider-reported tokens for the actual curve.

## Results

After one unmeasured session initialized WordPress's per-user admin state, each measured
repetition used a fresh local Chrome instance and a new authenticated page session at the
protocol-pinned 1920 × 1080 CSS-pixel viewport. All 15 measured captures were identical
after distillation:

| Metric | Result | Unit |
|---|---:|---|
| Captured elements | 6,784 | elements/run |
| Distilled nodes | 797 | nodes/run |
| Actionable nodes with selector hints | 787 | nodes/run |
| Full compact observation | 89,114 | characters/run |
| Approximate observation size | 22,279 | tokens/run |
| Range across 15 runs | **0** | approximate tokens |

These values were requalified across 15 fresh sessions on 2026-07-22 after CDP capture
began retaining dispatchable selectors for links without HTML ids. This makes the complete
page actionable rather than presenting selector-free links; the full observation remains
below the separate 100,000-character bootstrap ceiling. The seed reset also deletes
WordPress's stock “Hello world!” post. The corpus is now exactly the 120
named benchmark posts rather than 120 named posts plus an unrelated first row. The zero
range and size gate remain unchanged.

This clears E1.1's ≥5K-token and ≥15-run stability criteria. It also clears every cache
minimum currently documented in [02](../02-architecture.md#caching-the-claim-is-currently-false),
including the 4,096-token Opus/Haiku threshold.

## Scriptability and independent verification

The candidate task selects *k* named seeded posts on the 100-row page, chooses the bulk
`Move to Trash` action, and applies it. The page exposes stable checkbox IDs, the bulk
select, and the apply button through Rote's current perception/action stack. Varying *k*
produces a controllable 10–25-step family; E1.2 owns the exact cells and wording.

A manual five-post probe completed the browser operation. The launch protocol now uses
`verify-trash-posts.sh` to compare the exact trashed title set through WP-CLI; count-only
verification was rejected after a live run moved the wrong post with the right cardinality
(#77). Verification therefore comes from WordPress's database, not from either agent's
completion claim or page prose. `reset-state.sh` restores all 120 posts to the same published state
between measured repetitions.

## What this does not prove

- It does not prove the G1 curve; no model or competitor ran in T2.
- It does not prove A4's reduction ratio; E1.8 measures that over protocol transitions.
- It does not prove provider caching; E3 measures actual cache buckets after the curve.
- It does not evaluate the fixed 7/10/15/20/25-step protocol; E1 collects those runs.

## Conclusion

E1.1 is complete. The page is real, local, digest-pinned, resettable, over the observation
size floor, stable across 15 fresh measured sessions after one declared warm-up, actionable by the current harness, and backed
by an independent database-level verify. E1.2 can now define the curve protocol against a
fixed target rather than designing around a hypothetical page.
