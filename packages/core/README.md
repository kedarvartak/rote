# @rote/core

Zod schemas, pure data-transformation logic, and serializers for Rote's core
data model: TrajectoryEvent, RunManifest, EnvFingerprint, Playbook, Patch, and
the closed Expect DSL. See `docs/02-architecture.md` for the design behind
these types and `docs/05-roadmap.md` (M0) for what this package covers.

This package has **zero I/O** — no filesystem, no network, no clock reads
beyond what callers pass in. Recording (M1), replay execution (M2), matching
(M4), and distillation (M5) all depend on `@rote/core` for types and pure
logic; `@rote/core` itself depends on nothing internal.

## Action contracts (#143)

`ActionContractSchema` (strict, version 1) captures verb, target identity/context,
value-free affordance, safety class, observable preconditions, and an optional required
authoritative-effect reference. `compareActionContracts(recorded, current)` applies the
explicit compatibility matrix: name/stable-id changes are reported drift; verb, role,
context, affordance, destination, safety, precondition, or declared-effect changes are a
`contract_mismatch`. See `docs/testing/T35-action-contract-gate.md`.

## Public API

See `src/index.ts` for the full export list. Highlights:

- **Schemas & types** — `TrajectoryEventSchema`, `RunManifestSchema`,
  `EnvFingerprintSchema`, `EnvFingerprintPatternSchema`, `PlaybookSchema`,
  `PatchSchema`, `ExpectSchema`, `BrowserExpectSchema`, `BrowserReplayCandidateSchema` — and their inferred TS types.
- **Digests** — `computeResultDigest`, `decideStorage`, `verifyInlineResultRef`.
- **Templating** — `extractParamRefs` / `renderTemplate` over the `{{param}}` grammar.
  A reference with no *own* binding raises `UnboundParamError`, including names
  inherited from `Object.prototype` (`{{toString}}` is unbound, not a function).
  `\{{param}}` renders as the literal text `{{param}}`; a literal backslash cannot
  precede a live reference (#211).
- **Fingerprinting** — `buildEnvFingerprint`, `canonicalStringify` (key-sorted, array
  order preserved) and `sha256Hex`. Fails closed with `NonCanonicalValueError` on any value JSON cannot carry
  faithfully — a `Date`, `Map`, `Set` or class instance (all of which would hash as `{}`),
  a non-finite number or an `undefined` array element (all of which would hash as `null`) —
  because the hash gates environment matching and two different environments must never
  share one. An `undefined` object property is still dropped: in JSON that is the same
  statement as an absent key.
- **Patching** — `applyPatch` (throws `UnknownStepError` /
  `PlaybookMismatchError`).
- **Serialization** — `writeTrajectoryJsonl` / `parseTrajectoryJsonl`,
  `writePlaybookYaml` / `parsePlaybookYaml`. Trajectory reads tolerate exactly one
  thing: a final line that is *syntactically* incomplete, which is what a process
  killed mid-append leaves. A final line that is complete JSON but not a valid event
  is corruption and raises `TrajectoryParseError` like any other line. A `__proto__`
  key, which no record rebuilt by assignment can carry, is refused on both write and
  read (`TrajectoryKeyError`) rather than silently dropped.
- **Verification evidence (E7.4)** — `VerificationEvidenceEnvelopeSchema` (versioned,
  strict, digest-only — a raw payload or credential field fails parse),
  `EvidencePolicySchema` (only authoritative classes are requirable),
  `evaluateEvidencePolicy` (pure: classifies missing / task-mismatch / stale /
  inconsistent in order), `buildEvidenceEnvelope` / `digestEvidencePayload`
  (canonical key-order-independent digests), and the injected
  `AuthoritativeEvidenceAdapter` interface.

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
