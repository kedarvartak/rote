# 07 — Where Rote Works Best

## One sentence

**Rote works best when the task changes in parameters, but the procedure stays the same.**

It works poorly when every run needs a genuinely new plan.

## The fit test

Ask these questions before trying to memoize a workflow:

| Question | Good sign | Bad sign |
|---|---|---|
| Does this task recur? | Same class happens daily/weekly | One-off task |
| Does the procedure stay stable? | Same screens, commands, APIs, checklist | New path each time |
| Are inputs mostly parameters? | Different customer/vendor/report/query | Different goal/logic each time |
| Can we verify success cheaply? | Confirmation text, exit code, file exists, JSON shape | Subjective/creative output only |
| Is exploration expensive? | Browser DOM, screenshots, repo discovery, long logs | One or two cheap calls |

If most answers are in the good column, Rote is likely useful.

## Best-fit use cases

### 1. Browser and portal automation

This is the strongest first wedge.

Examples:

- download a recurring report from a portal
- submit an invoice
- fill a vendor onboarding form
- update a customer record
- search a catalog and export top results
- file a ticket in an internal admin UI

Why Rote helps:

- the UI workflow repeats
- values change, but the path stays similar
- browser agents burn many tokens inspecting pages, DOM trees, screenshots, and retry states
- assertions can catch drift, such as a selector changing
- scoped repair can fix one broken step instead of re-exploring the whole portal

Good Rote shape:

```text
same portal + same workflow + new values = replayable playbook
```

### 2. Internal operations workflows

Examples:

- support-ticket triage
- refund processing
- compliance checklist execution
- vendor/customer record updates
- monthly report generation
- routing requests between systems

Why Rote helps:

- operations work is repetitive
- the procedure is often auditable/checklist-like
- teams care about deterministic behavior and logs
- success can usually be verified with concrete checks

Good Rote shape:

```text
same business process + different case/customer = parameterized replay
```

### 3. Coding-agent repo rituals

Rote can help coding agents, but usually not by replaying an entire bug fix.

Good coding-agent examples:

- discover and run this repo's test suite
- reproduce a CI failure locally
- run lint/typecheck/test validation
- execute a release checklist
- bump version, update changelog, tag a dry-run release
- learn repo-specific setup commands and environment variables

Why Rote helps:

- coding agents repeatedly rediscover repo rituals
- each fresh session may grep `package.json`, docs, CI config, and test scripts again
- Rote can remove the setup/discovery tax

Good Rote shape:

```text
same repo + repeated validation/release/setup procedure = useful playbook
```

But Claude/Codex still handles the creative part: the actual code edit, debugging judgment, or design choice.

## Weak-fit use cases

### 1. Novel debugging and feature work

Examples:

- fix a new race condition
- design a new authentication architecture
- debug a production incident with unknown cause
- implement a novel billing rule

Why Rote is weaker:

- the needed files, hypotheses, and edits differ per run
- the most expensive part may be reasoning, not repeated navigation
- a previous trajectory can be misleading

Rote may still help with validation steps, but should not force a full replay.

### 2. Creative or open-ended tasks

Examples:

- write a strategy doc
- design a landing page
- brainstorm product ideas
- perform open-ended research

Why Rote is weaker:

- output quality is subjective
- there may be no stable procedure
- success is hard to assert with cheap deterministic checks

### 3. One-shot tasks

If a task never repeats, memoization cannot amortize the cold run.

Rote should miss and let the baseline agent run. The only cost should be small matcher overhead.

## Coding agents: useful, but not the first wedge

Coding agents are a secondary market because many coding tasks are unique-ish.

Without Rote, a coding agent may repeatedly do:

```text
ls
cat package.json
grep test
read README
inspect CI config
try npm test
try npm run test
find env vars
run lint/typecheck
```

Rote can turn the stable part into a playbook:

```text
run seed command
run targeted test command
read known failure output
apply LLM-generated patch
run targeted test
run lint
run typecheck
```

The benefit is removing repeated repo-discovery work. The agent still needs to reason about the code change.

So the coding-agent fit is:

| Coding task | Fit |
|---|---|
| Run repo validation checklist | High |
| Reproduce common CI failure flow | Medium/high |
| Release checklist | High |
| Fix arbitrary new bug | Medium/low |
| Design new feature | Low |

## What Rote should do on weak fits

Rote should be conservative:

```text
weak match → miss → baseline agent runs → recorder captures trajectory
```

It should not replay a 60% similar playbook just because some steps overlap. Wrong replay is worse than no replay.

Later versions may support reusable sub-playbooks or prefix replay, but v1 treats whole-playbook false positives as the dangerous failure mode.

## Rule of thumb

Rote is most valuable when the user says:

> “Do this same workflow again, but with different values.”

Rote is least valuable when the user says:

> “Figure out something genuinely new.”
