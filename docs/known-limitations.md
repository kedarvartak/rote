# Known limitations

This page describes the build that exists now, not the architecture Rote intends to grow
into. It is part of the launch contract: a user should be able to reject Rote from this
page before spending a token.

## Product boundary

| Area | Current limit | Practical consequence |
|---|---|---|
| Memory tiers | Only tier-0 working-memory controls are integrated. There is no playbook distiller, matcher, episodic learning, or site memory. | Rote does **not learn** from ordinary runs. Replay candidates are created or supplied explicitly. |
| History growth | Observation eviction and diffs are built; scheduled history compaction is not. | The measured curve is a smaller-growth quadratic, not linear or bounded-context execution. |
| Decision plane | Model routing and speculative execution are not built. | Every frontier step uses the configured planner model; there is no automatic cheap-model routing. |
| Replay selection | Candidate selection is explicit and the environment gate is exact, not fuzzy. | A fingerprint mismatch goes cold. There is no semantic task matching or automatic reuse. |
| Replay recovery | Failed replay reaches a classified cold fallback from the initial URL, but browser navigation cannot undo arbitrary server-side mutations. | Only replay retry-safe workflows with assertions before unsafe continuation and explicit site reset/compensation semantics. |

Do not describe this release as learned memory, autonomous workflow generation, linear
scaling, or zero-LLM operation for ordinary tasks.

## Browser and task fit

- **Chrome/Chromium only.** The shipped backend uses CDP. Firefox, Safari, mobile browsers,
  and native applications are untested.
- **DOM/accessibility-oriented perception.** Canvas-only, vision-heavy, remote-desktop,
  complex cross-origin iframe, and unusual shadow-DOM workflows are not certified.
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
[T11](testing/T11-cache-key-economics.md), [T20](testing/T20-b2-exact-certification.md), [T21](testing/T21-b5-drift-certification.md), [T22](testing/T22-stagehand-qualification.md), [T23](testing/T23-skyvern-qualification.md), [T24](testing/T24-browser-use-0137-qualification.md), [T25](testing/T25-browser-use-0137-paired-certification.md), [T26](testing/T26-post-action-evidence-qualification.md), and [T27](testing/T27-magnitude-qualification.md).

## Provider, packaging, and operations

- OpenAI is the canonical measured provider. Anthropic accounting is implemented, but
  explicit Anthropic cache-layout economics remain unqualified.
- Pricing is a dated benchmark snapshot, not a billing guarantee.
- `@rote/cli@0.1.0` passes tarball build/install/live smokes but is not npm-published as of
  2026-07-24. The unscoped `rote` name is occupied; scoped publication awaits npm scope
  ownership and authentication ([T14](testing/T14-cli-package-candidate.md), [#107](https://github.com/kedarvartak/rote/issues/107)).
- The CLI requires Node 20+ and an installed Chrome/Chromium executable.
- Windows and macOS package installation are not yet exercised in CI; current package
  evidence is Linux.

## Deliberately deferred

B5 now certifies deterministic semantic target repair only; arbitrary workflow repair remains absent. Scheduled compaction, distillation,
automatic matching, site memory, routing, and speculation remain post-G2 work. Deferral
means “not claimed,” not “implicitly working.” The authoritative sequence is
[07 — Execution plan](07-execution-plan.md).
