# T19 — B2 exact-verification correction and qualification

## Finding

The frozen G2 B2 task requested eight field values, but its independent live-page oracle
required only the generic text `Vendor registration complete`. The fixture itself required
only company and email. A run could therefore omit tax ID, address, city, postal code,
country, or phone and still be recorded as success.

A deterministic audit of T13's Rote trajectories finds all eight exact selector/value
pairs in 18/18 B2 runs. Browser Use dumps do
not retain action arguments; its final self-report says all fields were filled, but agent
self-report is not independent evidence. **The historical B2 success-parity and 77.3%
token-reduction claim are withdrawn pending a corrective exact-verification matrix.** B1
and B3 use task-specific terminal signals and are unaffected.

A second latent defect existed in the hand-written B2 replay playbook: it bound only
company, email, and country. T13 used cold planning rather than this candidate, but the
playbook could have claimed completion while omitting five requested values.

## Correction

Protocol `p1-g2-fixtures-v2-b2-exact` now makes every requested control required and emits
one composite terminal DOM string containing all eight exact values:

```text
Vendor registration complete | company_name=Northwind Supply |
contact_email=ap@northwind.test | tax_id=84-1129930 |
address_line1=18 Harbor Way | city=Portland | postal_code=97209 |
country=US | phone=503-555-0148
```

Both harnesses receive that entire string as `verify_text`. The B2 playbook now declares,
binds, asserts, and finally verifies all eight values; the opt-in real-Chrome replay passes
with zero LLM calls. The sacred benchmark invariant suite
rejects a generic completion oracle and checks the fixture, task protocol, and replay
contract together.

## Qualification smoke

A fresh Rote→Browser Use pair under the corrected protocol passed the exact live oracle:

| Harness | Outcome | Logical input | Output |
|---|---|---:|---:|
| Rote | exact success | 8,005 | 383 |
| Browser Use 0.13.6 | exact success | 46,659 | 1,459 |

This one pair qualifies the instrument only. It does not restore the B2 G2 claim; at least
15 successful attempts per harness and the same matched-bootstrap audit are still required.

- [Rote raw row](data/T19-b2-exact-rote-raw.json)
- [Rote manifest](data/T19-b2-exact-rote-manifests.json)
- [Rote provider receipts](data/T19-b2-exact-rote-provider-receipts.json)
- [Browser Use raw row](data/T19-b2-exact-browser-use-raw.json)
- [Browser Use diagnostic dump and receipts](data/T19-b2-exact-browser-use-dumps.json)
- [Concise output](data/T19-b2-exact-output.txt)

## Decision

Corrective B2 certification precedes formal B5 drift work. Measuring drift against a
completion-only oracle would grade stale or incomplete state as repaired and violate the
same invariant B5 is meant to test.
