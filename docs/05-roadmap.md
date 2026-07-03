# 05 — Roadmap & Open Questions

## Phase 0 — Thesis validation (weeks 1–3)
**Goal: the "run it twice" number.**

- Recorder as a thin wrapper over the existing browser-automation MCP tools (JSONL out).
- Hand-distill 2–3 playbooks first (no Distiller LLM yet) — prove the *executor* economics
  before automating the compiler.
- Replay Executor with assertion gates; repair = manual fallback initially.
- Run benchmark suite B1–B3. **Gate: ≥80% token reduction at success parity, or stop.**

## Phase 1 — The loop closes (weeks 4–8)
- Distiller v1: LLM pass doing causal pruning + parameterization + assertion synthesis.
- Matcher v1: fingerprint gate + embedding shortlist + confirm-and-bind call.
- Repair Agent v1: scoped single-step repair with persisted patches.
- Full benchmark including B5 (drift) and B6 (false match); publish numbers + notebook.

## Phase 2 — Adoptable artifact (weeks 9–16)
- MCP proxy mode (zero-code-change adoption for any MCP client).
- TypeScript + Python SDK wrappers (Claude Agent SDK, Vercel AI SDK adapters first).
- Playbook YAML export/import; local store; CLI (`memo ls`, `memo diff v2 v3`, `memo replay`).
- OSS release with the benchmark as the README headline.

## Phase 3 — Control plane (months 5+)
- Hosted store: teams share playbooks across agents/machines; RBAC; audit export.
- Drift dashboard (the observability wedge doubles as the sales demo).
- Coding-agent vertical (C1–C3) as second market.

## Open questions (tracked honestly)

1. **Matching threshold policy** — how conservative should τ be at launch? Start
   very conservative (prefer misses) and loosen with confidence data, or tune per-vertical?
   Current lean: conservative + per-playbook learned thresholds.
2. **Judgment-gate scope** — how much branching can a playbook encode before it's just a
   badly-authored workflow engine? Current lean: hard cap (≤2 gates/playbook); tasks
   needing more stay unmemoized.
3. **Assertion strength vs brittleness** — over-tight assertions cause spurious repairs;
   loose ones let drift through. Likely needs assertion-level confidence learning.
4. **Cross-tenant playbook sharing** — huge value (learn once per *ecosystem*, e.g. every
   team's "file a Jira ticket" playbook), serious privacy/leakage design problem. Defer.
5. **Naming** — settled on **Rote** (learning by rote = replay from memory without
   re-derivation). Still to do before OSS launch: trademark/package-namespace check
   (npm/PyPI `rote`), and secure the GitHub org + domain.
