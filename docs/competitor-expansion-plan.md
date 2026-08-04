# Competitor expansion plan

Rote's broad G1 and historical G2 comparison uses Browser Use 0.13.6; T25 separately
certifies corrected B2 against 0.13.7. Further comparisons should broaden coverage
without turning unlike products into one misleading leaderboard.

## Order

| Priority | Harness | Why next | Comparison mode |
|---|---|---|---|
| 1 | **Stagehand 3.7.1 — feasibility stopped** | T22 found 1/6 exact cold successes, incomplete cold provider receipts, and cached oracle failures; no certification matrix | retained diagnostic only |
| 2 | **Skyvern 1.0.47 — feasibility stopped** | T23 observed exact generated-code/fallback execution but no complete raw-provider receipt set; no token/cost certification matrix | retained cold and generated-code warm/drift diagnostics |
| 3 | **Browser Use 0.13.7 — corrected B2 certified** | T24 cleared feasibility; T25 then collected 18 fresh ordered pairs per harness with exact parity and complete receipt reconciliation | cold re-reasoning control |
| 4 | **Magnitude 0.3.1 — feasibility stopped** | T27 retained six bounded corrected-B2 timeouts, no exact/harness conclusions, and no complete raw provider receipts; no certification matrix | retained cold diagnostic only |
| Later | Notte and lab CUAs | Useful for capability ceilings, but API and accounting comparability are weaker | separate appendix, not the primary efficiency table |

Stagehand came first because B5 tests the exact feature it markets: cached actions that
self-heal after page change. T22 stopped before certification rather than success-hunt an
unreliable cold cell. Skyvern followed because it is the strongest product-level comparison for learned replay. T23 stopped before certification when the receipt gate failed, and the comparison remains asymmetric until Rote's P2 distiller exists.

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
- raw provider receipts, harness conclusion, and an independent exact terminal-state oracle (CDP live-page text or an authoritative server-side state audit, frozen before collection);
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
2. **Skyvern feasibility — stopped in T23:** the pinned 1.0.47 image produced exact cold preparations and generated-code warm/drift results, but every completed paired run triggered AI fallback and self-hosted logs exposed aggregate metrics rather than complete raw provider responses. No token/cost ranking is allowed.
3. **Skyvern certification — not opened:** retain T23 diagnostics; revisit only with complete provider receipts and a newly frozen protocol.
4. **Browser Use refresh feasibility — passed in T24:** pinned 0.13.7 passed 3/3 corrected B2 cold attempts and 5/5 B5 cold diagnostics with complete receipts. Historical 0.13.6 evidence remains unchanged.
5. **Browser Use 0.13.7 certification — passed in T25:** 18/18 fresh ordered attempts per harness passed the exact corrected-B2 oracle; every raw receipt reconciled, permitting a cell-specific token/cost/latency comparison. Historical 0.13.6 evidence remains frozen.
6. **Magnitude feasibility — stopped in T27:** pinned 0.3.1 reached neither a harness conclusion nor the exact corrected-B2 oracle in six frozen 90-second attempts. Aggregate usage events were retained, but 0/6 attempts exposed complete raw provider receipts. B5 and certification were not run.

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
