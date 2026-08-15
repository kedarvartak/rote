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
  destination/method/safety, and coded `quirk`s (`enter_inserts_newline`,
  `submit_is_mutating`). Deterministic ids; no clock, no I/O.
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

Not here yet: the ≤1K-token *site brief* the context assembler will render from a view
under the tier-0 token budget (roadmap item 11's second half), and settle-prior derivation
(the schema kind exists; the settledness telemetry that feeds it is not yet recorded per step).

## Tests

```bash
npx vitest run packages/site-memory
```

`test/invariants/site-memory-fails-closed.test.ts` records a live loop run with typed values
and a secret query string, derives memory, and asserts value-freedom, partition isolation,
and append-only recovery.
