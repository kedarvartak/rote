# T30 — Target identity v2 qualification

**Date:** 2026-08-10  
**Milestone:** P2 / E7.2  
**Source:** issue #128; E7.1 protocol `p2-enterprise-contract-corpus-v1`

## Question

Can a durable target identity distinguish repeated enterprise-grid controls while staying
stable through harmless reorder, generic wrapper insertion, DOM remount, and selector
rename—without placing captured values in identity or choosing an unresolved collision?

This is an identity qualification, not iframe/shadow traversal, action-contract drift,
or enterprise-readiness evidence.

## Contract

New captures emit:

```text
version = 2
hash = SHA-256(v2, role, accessible name, context hash, container-lineage hash)[0:16]
```

The context and container component hashes are retained for auditability. Planner/action
references render as `v2:<hash>` so trajectories do not discard the version; historical
16-hex v1 references stay unprefixed and degrade through semantic recovery rather than
being rewritten. Container input
is limited to semantic container kind, `role`, `aria-label`, and explicit `data-row-key`.
Generic layout wrappers, selectors, and control values are excluded. Historical `{ hash }`
v1 values remain parseable and are never upgraded in place.

Residual duplicate IDs or duplicate exact role/name candidates raise
`ElementResolutionAmbiguityError` before text or selector fallback.

## Deterministic results

| Control | Result |
|---|---:|
| Property-generated row sets across reorder, generic insertion, and selector rename | 100/100 stable |
| Changed virtual-row key | identity changed exactly |
| Historical v1 schema parse | unchanged |
| Sensitive password-value substitutions | identical IDs; values absent from IDs and names |
| Real-Chrome repetitions | 2/2 passed |
| Keyed repeated controls distinct in each Chrome repetition | 3/3 |
| Keyed controls stable after live row reorder | 3/3 |
| Deliberately unkeyed ambiguous pair | 2/2 typed ambiguity failures |
| Provider/repair calls | 0 |

The Chrome test uses the E7.1 repeated-grid fixture at 1,440 × 900 CSS px, captures through
the product CDP and perception path, mutates live row order, remounts the virtual row, and
runs twice. Mandatory CI fails if Chrome is absent rather than skipping.

## Reproduce

```bash
npm test --workspace @rote/perception
npm test --workspace @rote/action
npm run test:identity-chrome --workspace @rote/action
```

## Claims boundary

T30 establishes top-level light-DOM target identity and fail-closed residual ambiguity.
E7.3 must populate identities through iframe/open-shadow context paths. More importantly,
identity only answers *which control*. It does not prove that a persistent control retains
the same interaction, safety, side-effect, or authoritative-outcome contract. #143 remains
the cross-cutting structural-drift priority across E7.3–E7.6 and distiller v1.
