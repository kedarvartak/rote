# Competitor expansion plan

Rote's published comparison currently uses Browser Use 0.13.6. The next comparison should
broaden coverage without turning unlike products into one misleading leaderboard.

## Order

| Priority | Harness | Why next | Comparison mode |
|---|---|---|---|
| 1 | **Stagehand 3.7.1 — feasibility stopped** | T22 found 1/6 exact cold successes, incomplete cold provider receipts, and cached oracle failures; no certification matrix | retained diagnostic only |
| 2 | **Skyvern — next** | Ships agent → generated code → zero-LLM replay → fallback | cold agent, generated-code warm run, drifted warm run |
| 3 | **Browser Use current pinned release** | Maintains continuity with G1/G2 and measures version drift | cold re-reasoning control |
| 4 | **Magnitude** | Vision-native contrast; useful for capability/cost boundaries | cold only unless a documented cache path exists |
| Later | Notte and lab CUAs | Useful for capability ceilings, but API and accounting comparability are weaker | separate appendix, not the primary efficiency table |

Stagehand came first because B5 tests the exact feature it markets: cached actions that
self-heal after page change. T22 stopped before certification rather than success-hunt an
unreliable cold cell. Skyvern follows because it is the strongest product-level
comparison for learned replay, but that comparison becomes fully symmetric only after
Rote's P2 distiller exists.

## Frozen common protocol

Every adapter must use:

- the same deterministic B1–B3 fixtures and B5 mutation URLs;
- the same task text, initial URL, values, viewport, fixture reset, and exact live oracle;
- one pinned, unmodified released harness version with lockfile/container digest;
- the same provider and model where the harness permits it;
- initial navigation excluded consistently;
- at least 3 paired qualification runs before any certification spend;
- at least 15 attempts per harness/task for a published cell;
- ordered, append-safe paired collection with failed and abandoned attempts retained;
- raw provider receipts, harness conclusion, and an independent CDP live-page capture;
- uncached, cache-read, cache-write, and output token buckets kept separate.

A harness that cannot expose reliable provider receipts may appear in a capability table,
but not in token or dollar rankings. Missing evidence is not zero.

## Two scorecards, not one

### Cold-agent scorecard

Compares first-attempt task execution:

- exact success rate;
- logical tokens and billed cost per task;
- wall-clock latency;
- observation versus reasoning token sources where exposed.

This extends the current Browser Use comparison to Stagehand agent, Skyvern agent, and
Magnitude without pretending that replay has already been learned.

### Warm-reuse and drift scorecard

Compares each harness's documented reuse path:

- preparation cost and number of successful demonstrations required;
- warm exact success rate;
- zero-model versus model-assisted warm execution;
- B5 drift recovery without full cold fallback;
- detected fallback rate;
- observed silent-failure rate with a 95% binomial interval;
- repair tokens and latency relative to that harness's own cold run;
- whether successful repair versions the cached artifact.

Preparation cost is reported separately and amortized at 1, 5, 10, and 50 recurrences.
Rote's current hand-written playbook must be labelled **hand-authored**; it cannot be
presented as equivalent to Skyvern-generated code until the P2 distiller ships.

## Adapter contract

Each competitor adapter should emit the existing neutral run record plus a diagnostic
dump containing:

- harness/version/container identity;
- provider/model and cache settings;
- task, mutation, repetition, and phase (`cold|warm|repair|fallback`);
- harness-declared conclusion;
- independent exact-oracle result;
- raw provider usage receipts;
- cached-artifact identity/version where applicable;
- repair and fallback classifications;
- timestamps and duration in milliseconds.

The report layer rejects model, viewport, task, oracle, fixture, repetition, or receipt
mismatches before calculating an interval.

## Execution sequence

1. **Stagehand feasibility — stopped in T22:** pinned 3.7.1 emitted only one exact cold
   success in six attempts and no complete raw cold-provider receipt set. The one available
   pair remains diagnostic; no ≥15-run matrix is allowed for this protocol.
2. **Skyvern feasibility:** self-host the pinned release, exercise documented code caching,
   and identify where generation, replay, fallback, and regeneration usage are exposed.
3. **Skyvern certification:** freeze a new protocol before looking at comparative totals.
4. **Browser Use refresh:** rerun only after pinning a newer release; retain 0.13.6 as the
   historical baseline rather than silently replacing it.
5. Add Magnitude only after the three primary harnesses have reproducible adapters.

## Claims this plan does not permit

- “Rote learns” before automated distillation exists.
- “Rote repairs arbitrary drift”; B5 currently covers deterministic target resolution.
- Comparing Rote warm replay only against competitor cold runs without showing their warm
  path where one exists.
- Universal superiority from local fixtures.
- Treating no thrown exception or harness self-report as task success.
- Treating provider cache discounts as logical-token reduction.

## Exit artifact

The expansion is complete when one command rebuilds a versioned report containing:

1. a cold-agent table across all qualified harnesses;
2. a warm-reuse/drift table for harnesses with documented reuse;
3. preparation/amortization curves;
4. exact success and silent-failure intervals;
5. links to every raw receipt and independent verification dump.
