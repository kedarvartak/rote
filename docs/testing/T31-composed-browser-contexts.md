# T31 — Composed browser-context qualification

**Date:** 2026-08-10  
**Milestone:** P2 / E7.3  
**Source:** issue #129; E7.1 protocol `p2-enterprise-contract-corpus-v1`

## Question

Can Rote capture, distill, diff, resolve, and dispatch through nested same-origin and
cross-origin frames and nested open shadow roots while rejecting context splicing, stale
frame documents, duplicate inner controls, and declared closed roots before mutation?

This is a deterministic synthetic browser-mechanism qualification. It is not production-
site certification, authoritative-evidence adapter qualification (E7.4), expanded action
vocabulary (E7.5), or structural action-contract compatibility (#143).

## Contract

A version-1 browser-context coordinate contains ordered frame/shadow segments, a durable
`contextHash`, and a fresh `documentToken`. Stable identity hashes the durable path; the
document token is excluded from identity and checked immediately before dispatch.

- Frame segments hash a stable frame name/key and origin.
- Shadow segments hash an explicit host key and record open/closed mode.
- Runtime CDP frame IDs, execution-context IDs, selectors, and document tokens never enter
  target identity.
- Planner observations expose only `context=<hash>` below the stable cache line.
- Resolution filters by context before role/name or text similarity.
- Navigation/detach after resolution returns `BROWSER_CONTEXT_STALE`.
- A declared closed root returns `CLOSED_SHADOW_ROOT_UNSUPPORTED`; it is never pierced.

## Deterministic results

| Control | Result |
|---|---:|
| Positive real-Chrome repetitions | 2/2 passed |
| Nested frame depths | 2 same-origin + 2 cross-origin segments per repetition |
| Nested open-shadow depth | 2 segments per repetition |
| Exact external frame events | 4/4 |
| Exact external open-shadow events | 2/2 |
| Composed capture diff reconstruction | exact in 2/2 repetitions |
| Context-splice controls | 1/1 `BROWSER_CONTEXT_MISMATCH`, zero events |
| Frame remount between resolution and dispatch | 1/1 `BROWSER_CONTEXT_STALE`, zero events |
| Duplicate inner controls | 1/1 typed ambiguity, zero events |
| Declared closed-root controls | direct + replay boundary typed unsupported, zero decoy events |
| Provider/repair calls | 0 |

The positive test clicks both nested frame controls and the nested open-shadow control
through `BrowserToolCaller` and `CdpPage`, then queries E7.1's server-side task oracle.
Harness return alone is insufficient. The negative test retains zero authoritative events
across every failure control. CI runs this test explicitly twice for positive paths and
fails if Chrome is unavailable.

## Reproduce

```bash
npm run test:enterprise-context-chrome --workspace @rote/bench
```

The pre-existing T29 direct-fixture and T30 identity Chrome contracts remain separate and
mandatory:

```bash
npm run test:enterprise-chrome --workspace @rote/bench
npm run test:identity-chrome --workspace @rote/action
```

## Claims boundary

T31 qualifies these synthetic fixtures and explicit context keys only. Closed roots that
do not expose the fixture's declared host boundary remain indistinguishable from absent
content and are unsupported, not safely discoverable. Frame/shadow actions still require
final task verification; E7.4 must add provenance/freshness/task-bound authoritative
evidence envelopes. Identity plus context still does not prove that a control's behavioral
contract remained compatible—#143 remains open.
