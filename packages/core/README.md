# @rote/core

Zod schemas, pure data-transformation logic, and serializers for Rote's core
data model: TrajectoryEvent, RunManifest, EnvFingerprint, Playbook, Patch, and
the closed Expect DSL. See `docs/02-architecture.md` for the design behind
these types and `docs/05-roadmap.md` (M0) for what this package covers.

This package has **zero I/O** — no filesystem, no network, no clock reads
beyond what callers pass in. Recording (M1), replay execution (M2), matching
(M4), and distillation (M5) all depend on `@rote/core` for types and pure
logic; `@rote/core` itself depends on nothing internal.

## Public API

See `src/index.ts` for the full export list. Highlights:

- **Schemas & types** — `TrajectoryEventSchema`, `RunManifestSchema`,
  `EnvFingerprintSchema`, `EnvFingerprintPatternSchema`, `PlaybookSchema`,
  `PatchSchema`, `ExpectSchema`, `BrowserExpectSchema`, `BrowserReplayCandidateSchema` — and their inferred TS types.
- **Fingerprinting** — `buildEnvFingerprint`, `canonicalStringify`, `sha256Hex`.
- **Digests** — `computeResultDigest`, `decideStorage`, `verifyInlineResultRef`.
- **Templating** — `extractParamRefs`, `renderTemplate` (throws
  `UnboundParamError` on a referenced-but-unbound param).
- **Patching** — `applyPatch` (throws `UnknownStepError` /
  `PlaybookMismatchError`).
- **Serialization** — `writeTrajectoryJsonl` / `parseTrajectoryJsonl`,
  `writePlaybookYaml` / `parsePlaybookYaml`.

## Known v1 limitations (tracked, not silently missing)

- `verifyInlineResultRef` only verifies `{ kind: 'inline' }` refs. Verifying a
  `{ kind: 'blob' }` ref requires reading the blob first — that's I/O, and
  belongs to whichever package owns the blob store (the recorder, from M1).
- Playbook round-trip is tested with a hand-written fixture
  (`fixtures/playbooks/b1-download-report.yaml`), not a fast-check generator —
  generating structurally-valid random step-DAGs (acyclic, param-consistent)
  is nontrivial enough to defer. TrajectoryEvent is property-tested.
- Param substitution renders a sole `{{param}}` string with its bound value's
  original type; a `{{param}}` embedded in a longer string always renders to
  text.

## Running tests

```bash
npm test --workspace @rote/core
```
