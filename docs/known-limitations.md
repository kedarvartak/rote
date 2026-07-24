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
  page it saw. Compare-across-pages tasks can lose evidence that was evicted.
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
| G2 positive token margin on three deterministic local fixtures | General web-task superiority or learned-memory economics |
| OpenAI cache-key economics on longer WordPress cells | Universal cost savings; the shortest cell crosses parity |
| Browser Use 0.13.6 comparison under pinned conditions | Current/future Browser Use releases or every competing harness |

G2's B2 token reduction does not clear the catalog's 80% target. None of the three G2
cells reaches the catalog's 5× latency target; B1 and B2 are below its 2× line. Cost,
latency, slope, rendered characters, and logical tokens are separate claims.

The canonical evidence and confidence intervals are [T10](testing/T10-g1-cumulative-token-curve.md),
[T11](testing/T11-cache-key-economics.md), and [T13](testing/T13-g2-certification.md).

## Provider, packaging, and operations

- OpenAI is the canonical measured provider. Anthropic accounting is implemented, but
  explicit Anthropic cache-layout economics remain unqualified.
- Pricing is a dated benchmark snapshot, not a billing guarantee.
- `@rote/cli@0.1.0` passes tarball build/install/live smokes but is not npm-published as of
  2026-07-24. The unscoped `rote` name is occupied; scoped publication awaits npm scope
  ownership and authentication ([T14](testing/T14-cli-package-candidate.md)).
- The CLI requires Node 20+ and an installed Chrome/Chromium executable.
- Windows and macOS package installation are not yet exercised in CI; current package
  evidence is Linux.

## Deliberately deferred

B5 DOM drift, an eviction recall-trade stress task, scheduled compaction, distillation,
automatic matching, site memory, routing, and speculation remain post-G2 work. Deferral
means “not claimed,” not “implicitly working.” The authoritative sequence is
[07 — Execution plan](07-execution-plan.md).
