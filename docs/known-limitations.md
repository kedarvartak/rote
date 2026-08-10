# Known limitations

This page describes the build that exists now, not the architecture Rote intends to grow
into. It is part of the launch contract: a user should be able to reject Rote from this
page before spending a token.

## Product boundary

| Area | Current limit | Practical consequence |
|---|---|---|
| Memory tiers | Only tier-0 working-memory controls are integrated. There is no playbook distiller, matcher, episodic learning, or site memory. | Rote does **not learn** from ordinary runs. Replay candidates are created or supplied explicitly. |
| History growth | Deterministic action-history compaction is built on `main`: after 24 exact actions it compacts on 16-action boundaries, retaining an exact tail and only actual older representatives. | Planner-visible action count is structurally bounded, but no 50+ step provider/SPA certification exists; do not generalize the frozen P1 curve into a production linear-scaling or cost claim. |
| Decision plane | Model routing and speculative execution are not built. | Every frontier step uses the configured planner model; there is no automatic cheap-model routing. |
| Replay selection | Candidate selection is explicit and the environment gate is exact, not fuzzy. | A fingerprint mismatch goes cold. There is no semantic task matching or automatic reuse. |
| Replay recovery | Failed replay reaches a classified cold fallback from the initial URL, but browser navigation cannot undo arbitrary server-side mutations. | Only replay retry-safe workflows with assertions before unsafe continuation and explicit site reset/compensation semantics. |

Do not describe this release as learned memory, autonomous workflow generation, linear
scaling, or zero-LLM operation for ordinary tasks.

## Browser and task fit

- **Chrome/Chromium only.** The shipped backend uses CDP. Firefox, Safari, mobile browsers,
  and native applications are untested.
- **Top-level light-DOM perception only.** Canvas-only, vision-heavy, remote-desktop,
  nested iframe, and shadow-DOM workflows are not supported or certified. E7.3 adds
  explicit same/cross-origin frame and open-shadow context traversal; closed roots remain
  a typed unsupported boundary.
- **Stable identity v1 can collide.** It hashes role, accessible name, and a coarse depth
  bucket—not actual ancestry or container context. Repeated controls in enterprise data
  grids may therefore resolve ambiguously. E7.2 versions the identity before automated
  distillation; current ambiguous resolution must fail closed rather than pick a target.
- **The live action vocabulary is narrow.** It supports navigate, fill, select, and click.
  Hover, keyboard chords, file upload, drag/drop, and arbitrary pointer sequences are not
  available. E7.5 adds only grounded, evidence-bearing primitives rather than a generic
  event escape hatch.
- **Long-running SPA and cross-session workflows are unqualified.** Route remounts,
  virtualized controls, background traffic, 50+ interaction tasks, and continuation after
  browser/process restart have no product certification. E7.1's direct Chrome smoke only
  proves the synthetic fixtures/oracles behave deterministically; E7.6 covers
  single-session endurance and E7.7 separately covers fingerprint-gated continuation
  without storing credentials.
- **Recall across pages is weak.** The tier-0 policy keeps what the agent did, not every
  page it saw. Compare-across-pages tasks can lose evidence that was evicted. The planner
  now receives an explicit recall boundary and can fail as `recall_unavailable`; fabricated
  completion is independently rejected ([T18](testing/T18-eviction-recall-trade.md)). The
  task still does not succeed without an external memory strategy.
- **Open-ended and creative work is a weak fit.** There may be no stable procedure or
  independent success signal to reuse.
- **Business-rule drift is not selector drift.** Repair cannot infer that a site's meaning
  or policy changed, and must not pretend otherwise.
- **Settledness is heuristic.** Long-lived requests and background traffic can exhaust the
  timeout. Historical certification retained such failures instead of hiding them.
- **Oversized first pages have a hard ceiling.** A grounded emergency bootstrap is allowed
  up to 100,000 rendered characters; larger captures fail before planning.

See [01 §Where Rote fits](01-problem.md#where-rote-fits--and-where-it-doesnt) for the
strong/weak-fit split.

## Verification and safety

- The public CLI requires visible-text and/or URL-substring verification. These checks are
  only as independent as the signal the caller chooses; ambiguous text can be a weak
  oracle. Richer Expect checks exist in replay, but are not fully exposed as CLI flags.
  E7.4 adds provenance/freshness-bound evidence envelopes and injected authoritative
  API/database/download-event adapters; UI evidence remains supporting evidence where it
  is genuinely task-specific.
- Ordinary live-agent fill/select/navigation actions enforce zero-LLM exact effect checks
  even when the planner correctly omits an ungrounded `expect`. Generic click diffs are
  recorded only as reaction diagnostics: T26's no-op, no-DOM-effect, and unrelated-mutation
  boundary shows the generic signal is unsafe to enforce. Final verification still carries
  task success and cannot be replaced by either signal.
- Rote is not a browser sandbox or authorization system. The model can act with the
  browser profile's privileges. Use only sites and accounts you are authorized to
  automate, with least-privilege test credentials first.
- `.rote/` artifacts are local plaintext. Prompts, tool arguments, URLs, form values, and
  provider receipts may contain sensitive data. Encryption, secret redaction, retention
  policy, multi-user access control, and remote artifact storage are not built.
- Append-only artifacts improve auditability, not confidentiality or transactional
  rollback. A browser action can have an irreversible external effect before a later
  assertion fails.

## Evidence boundary

| Proven | Not proven |
|---|---|
| One controlled self-hosted WordPress workflow, OpenAI `gpt-4.1-mini`, 9–25 required interactions | Production websites, other providers/models, vision-heavy tasks, or tasks below nine interactions |
| G1 logical-input slope reduction at exact success parity | Linear scaling or the same percentage at every endpoint |
| Corrected B1–B3 positive token margin on deterministic local fixtures | General web-task superiority or learned-memory economics |
| OpenAI cache-key economics on longer WordPress cells | Universal cost savings; the shortest cell crosses parity |
| Browser Use 0.13.6 G1/historical G2 and Browser Use 0.13.7 corrected-B2 comparison under separate pinned conditions | Current/future Browser Use performance, broader 0.13.7 tasks, or every competing harness; T22 Stagehand, T23 Skyvern, and T27 Magnitude remain stopped probes, while T25 certifies only one local corrected-B2 cell |

T19 withdraws the historical B2 row; T20 supersedes it with 18/18 exact-oracle attempts per
harness and an 83.6% token reduction (95% CI 82.7–84.6%). In the historical
matrix, none of the three cells reached the catalog's 5× latency target; B1 and B2 were
below its 2× line. Cost,
latency, slope, rendered characters, and logical tokens are separate claims.

T18 landed after the frozen matrices: its recall boundary adds volatile prompt text on
affected steps. That provider-token overhead has not been recertified. It is
a fail-closed safety change, not a new efficiency claim.

The canonical evidence and confidence intervals are [T10](testing/T10-g1-cumulative-token-curve.md),
[T11](testing/T11-cache-key-economics.md), [T20](testing/T20-b2-exact-certification.md), [T21](testing/T21-b5-drift-certification.md), [T22](testing/T22-stagehand-qualification.md), [T23](testing/T23-skyvern-qualification.md), [T24](testing/T24-browser-use-0137-qualification.md), [T25](testing/T25-browser-use-0137-paired-certification.md), [T26](testing/T26-post-action-evidence-qualification.md), [T27](testing/T27-magnitude-qualification.md), and [T28](testing/T28-registry-provider-quickstart.md).

## Provider, packaging, and operations

- OpenAI is the canonical measured provider. Anthropic accounting is implemented, but
  explicit Anthropic cache-layout economics remain unqualified.
- Pricing is a dated benchmark snapshot, not a billing guarantee.
- `@rotehq/cli@0.1.0` is npm-published and provider-verified from an empty directory in
  [T28](testing/T28-registry-provider-quickstart.md). Its immutable bundled README retains
  candidate-era wording that publication is pending; tracked docs correct this for later
  versions rather than changing published bytes. Version 0.1.0 predates B4; deterministic
  compaction is on `main` for a later package version. The unscoped `rote` and original
  `@rote` scope are controlled by unrelated owners ([T14](testing/T14-cli-package-candidate.md)).
- The CLI requires Node 20+ and an installed Chrome/Chromium executable.
- Windows and macOS package installation are not yet exercised in CI; current package
  evidence is Linux.

## Deliberately deferred

B5 now certifies deterministic semantic target repair only; arbitrary workflow repair remains absent. Long-run B4 qualification, enterprise
browser mechanisms E7.2–E7.7, distillation, automatic matching, site memory, routing, and
speculation remain post-G2 work. E7.1's frozen fixture contract is built but confers no
enterprise-browser capability. Deferral
means “not claimed,” not “implicitly working.” The authoritative sequence is
[07 — Execution plan](07-execution-plan.md).
