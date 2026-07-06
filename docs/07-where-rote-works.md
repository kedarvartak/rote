# 07 — Browser-Agent Fit: Where Rote Works

## One sentence

**Rote is a memoization layer for browser agents: as the agent uses a website over time, Rote learns the site's procedures, selectors, form semantics, and verification signals so future browser tasks need less exploration and fewer tokens.**

The narrow v1 benchmark uses repeated workflows because that is the cleanest way to prove savings. The broader product goal is not only “run the exact same flow again.” It is:

```text
less browser exploration over time
```

## The product scope

Rote should be scoped first to browser agents.

Not coding agents. Not generic creative agents. Not arbitrary web browsing.

The target user is a team running browser agents against real websites, portals, admin tools, and SaaS apps. Those agents repeatedly spend tokens figuring out:

- what page they are on
- which field means what
- which selector/button performs the action
- what confirmation state proves success
- which intermediate screens are dead ends
- how the site changes after login, search, submit, or download

Rote records this experience and turns it into reusable browser memory.

## What “memoization” means here

The first version of Rote memoizes full successful trajectories into playbooks:

```text
record successful browser run
→ distill essential steps
→ replay when safe
→ verify each step
→ repair/fallback on drift
```

But the long-term browser-agent value is broader:

```text
successful runs accumulate site knowledge
→ future runs need less DOM/screenshot exploration
→ stable parts replay or guide the agent
→ uncertain parts remain agent-controlled
```

So the value can come from three levels:

| Level | What Rote reuses | Example |
|---|---|---|
| Whole playbook | Full workflow | “Register a vendor on this portal” |
| Prefix/subflow | Stable setup/navigation | login → dashboard → vendor page |
| Site memory | Selectors, form semantics, verification states | `#tax-id` means tax id; success text is “Registration submitted” |

The safest v1 starts with whole playbooks. Later versions should move toward subflows and site memory.

## Where Rote helps browser agents most

### 1. Repeated portal work

Examples:

- download reports
- submit invoices
- register vendors
- update customer records
- check claim/payment/shipment status
- search a catalog and export results

Why it helps:

- browser exploration is expensive
- the same site has stable structure
- the same actions recur with different values
- success can be verified with page text, selectors, files, or JSON shape

Good fit:

```text
same website + similar task family + changing values
```

### 2. High-volume operational browser agents

Examples:

- support teams using agents in admin dashboards
- finance teams using agents across vendor portals
- procurement teams filling supplier forms
- logistics teams checking shipment portals
- healthcare/insurance teams checking eligibility or claim status

Why it helps:

- the agent fleet sees the same websites repeatedly
- exact tasks may differ, but site knowledge compounds
- even partial reuse can reduce exploration

Good fit:

```text
many tasks on the same websites over time
```

### 3. Browser agents with expensive observation loops

Browser agents often inspect:

- accessibility trees
- screenshots
- DOM snapshots
- page text
- available actions
- retry/error states

Those observations are token-heavy. If Rote can avoid even part of that repeated exploration, it saves cost and latency.

Good fit:

```text
agent spends lots of tokens figuring out where to click/fill/extract
```

## Where Rote is weaker

### 1. One-off websites

If every task is on a new website, Rote has little to reuse.

Example:

```text
today: book a flight on site A
tomorrow: research a product on site B
next day: use a random government form on site C
```

Rote should mostly miss and let the browser agent explore.

### 2. Open-ended browsing

Examples:

- “research this topic”
- “compare products across the web”
- “find interesting companies”
- “browse until you discover something useful”

These tasks do not have stable procedures or cheap success checks.

### 3. Sites that change meaning, not just layout

Rote can handle simple drift like moved buttons or renamed selectors. It is much harder when the site changes semantics:

```text
old field: amount
new field: quantity
same-looking UI, different meaning
```

Assertions and final verification must catch this. If not, fallback is safer than replay.

## Important distinction: not only exact repetition

The strongest benchmark is repeated workflow replay because it gives a clear number:

```text
cold run: explore everything
warm run: replay verified procedure
```

But the browser-agent product should not depend forever on exact repeats.

A more general browser-agent memory layer should eventually reuse:

- login flows
- navigation prefixes
- known selectors
- form-field meanings
- extraction schemas
- success/failure signals
- common repair patches

That means a future task can still benefit even if only part of the flow is familiar.

Example:

```text
Run 1: register vendor
Run 2: update vendor bank details
```

These are not the same workflow, but they may share:

```text
login → vendor dashboard → search vendor → open vendor profile
```

Rote v1 may treat them as separate playbooks. A stronger browser-agent Rote should learn and reuse the shared prefix.

## Why browser agents are still the right wedge

Browser tasks are the best place to prove Rote because:

- exploration is visibly expensive
- repeated site usage is common in business workflows
- tool calls are structured (`navigate`, `click`, `fill`, `extract`)
- assertions are natural (`selector_visible`, `text_visible`, `input_value`)
- drift is testable by changing selectors or page structure

This makes browser agents the clearest first use case for procedural memory.

## What Rote should do on weak matches

Rote should be conservative:

```text
high-confidence match → replay verified steps
partial/uncertain match → reuse only safe known context or miss
weak match → baseline browser agent explores
```

Wrong browser automation is worse than no optimization.

The core invariant remains:

```text
never silently wrong
```

Every replayed step must be assertion-gated, and final verification must pass.

## Rule of thumb

Rote is useful when the browser agent is likely to revisit the same website or app over time.

Rote is not useful when every task is a totally new site, goal, and UI.

The simple promise:

> The more your browser agent uses the same websites, the less it should need to explore them from scratch.

Next: [08 — Browser Memory Architecture](08-browser-memory-architecture.md) — how the
subflow and site-memory levels sketched above become concrete components, an evaluation
plan, and a competitive map.
