# @rote/site-memory

Tier-2 **site memory**: append-only, per-environment, *advisory* records of how a site
behaves — selector maps, form semantics, page graph, settle priors, quirks — learned from
recorded runs and consolidated on read. It informs; it never executes (see
`docs/02-architecture.md` "Tiers 1 and 2 — the learning plane"). Every record is value-free
by construction: pages are 16-hex digests of origin+pathname, targets are stable identity
refs/selectors, and the strict schema has no field that could hold a typed value, URL, or
query string.

## Public API

- `deriveSiteMemory(events, { fingerprintHash, runId, observedAt })` — pure: one recorded
  run (`{event, result}` pairs as `@rote/distiller`'s `loadRecordedRun` yields) → records +
  a `skipped` list with reasons. Emits `selector_map` for every dispatched element step
  with a stable identity, `page_edge` when the settled page differs from the acted page,
  one `form_semantics` per page from fill/select contracts + the submit's
  destination/method/safety, one `settle_prior` per (page, action kind) from the agent's
  measured `settle_ms` samples (nearest-rank p50/p90/max; a p90 at or past
  `LONG_SETTLE_P90_MS` = 3000 ms also earns the coded `long_settle` quirk), and coded
  `quirk`s (`enter_inserts_newline`, `submit_is_mutating`). Deterministic ids; no clock,
  no I/O.
- `consolidateSiteMemory(records, { now, halfLifeMs? })` — pure: collapses successive
  observations of one fact (`siteMemoryRecordKey`) to the newest with `observations`,
  `freshness` (half-life decay, default 30 days), `score = confidence × freshness`, and
  `changed` when the fact moved; returns a `SiteMemoryView` (`facts`, `byKind`).
- `FileSiteMemoryStore(baseDir)` / `MemorySiteMemoryStore` — `read(fingerprintHash)`,
  `append(fingerprintHash, records)`. Append-only JSONL under
  `site-memory/<fingerprint>/records.jsonl`; a truncated tail fragment is skipped and never
  edited, a complete-but-invalid line throws, and a record whose `fingerprint_hash` differs
  from the partition is refused (`SiteMemoryPartitionError`) on write and on read.
- Schema (`@rote/core`): `SiteMemoryRecordSchema` (v1, strict, discriminated on `kind`),
  `pageKey(url)`, `siteMemoryRecordKey(record)`.

- `renderSiteBrief(view, { maxChars, currentPageKey?, minScore? })` — pure: the ≤budget
  *site brief* — facts ranked (current page first, then confidence × freshness), rendered
  in fixed wording (quirks come from a closed vocabulary; nothing page- or model-authored
  is added), cut at a **hard** character cap, with `factsIncluded`/`factsDropped` and the
  `hintedStableIds` it mentions. Empty view or all-stale facts → empty text, so a cold site
  pays nothing. Pass it to `runBrowserAgent({ siteBrief })`: it lands in the planner's
  cache-stable prefix and the run reports `siteBriefUtility` (hinted vs used identities —
  docs/03 "hint utility").

Not here yet: the provider-billed T2 measurement that decides whether the brief earns
its tokens (docs/03 T2 ≥30%, retreat below 15%).

## Tests

```bash
npx vitest run packages/site-memory
```

`test/invariants/site-memory-fails-closed.test.ts` records a live loop run with typed values
and a secret query string, derives memory, and asserts value-freedom, partition isolation,
and append-only recovery.
