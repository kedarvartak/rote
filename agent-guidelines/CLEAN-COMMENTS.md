# CLEAN.md

Guidance for AI coding agents writing code in this repo.

The code should be easy to read because it is well-structured, well-named, and modular. Comments should be rare. Add comments only when they explain important context that the code cannot make obvious by itself.

## Core Rule

Do not narrate the code.

Avoid comments that simply repeat what the next line does. Prefer better names, smaller functions, and clearer structure.

Bad:

```ts
// Set loading to true
setLoading(true);

// Filter the tools
const filteredTools = tools.filter((tool) => tool.approved);
```

Good:

```ts
setIsLoadingUsage(true);

const approvedTools = tools.filter((tool) => tool.approved);
```

## When Comments Are Useful

Write comments only for important context:

- Non-obvious business rules
- Product decisions that affect behavior
- Security or privacy constraints
- Performance tradeoffs
- Temporary limitations
- External API quirks
- Complex algorithms or scoring logic
- Intentional deviations from the obvious approach

Example:

```ts
// Do not expose inferred profile data directly; employees should only see role-based recommendations.
const recommendationCopy = buildEmployeeSafeRecommendation(intervention);
```

Example:

```ts
// Weight recent usage more heavily so abandoned tools do not inflate current adoption.
const adoptionScore = calculateWeightedAdoptionScore(signals);
```

## When Not To Comment

Do not add comments for:

- Imports
- Props
- State declarations
- Simple event handlers
- Obvious conditionals
- Basic mapping/filtering
- Standard React hooks
- Tailwind class groups
- File or section banners
- Closing tags or JSX structure

Bad:

```tsx
// Import React
import { useState } from "react";

// Component for displaying metric card
export function MetricCard() {
  // State for selected card
  const [selectedCard, setSelectedCard] = useState<string | null>(null);

  // Return JSX
  return <div />;
}
```

Good:

```tsx
import { useState } from "react";

export function MetricCard() {
  const [selectedMetricId, setSelectedMetricId] = useState<string | null>(null);

  return <div />;
}
```

## Prefer Names Over Comments

If a comment explains what a variable or function does, rename the variable or function.

Bad:

```ts
// Checks if tool is risky because it is unapproved and used often
function check(tool: AiTool, sessions: number) {
  return !tool.approved && sessions > 20;
}
```

Good:

```ts
function isHighUsageUnapprovedTool(tool: AiTool, sessions: number) {
  return !tool.approved && sessions > 20;
}
```

## Prefer Extraction Over Comments

If a block needs a comment to explain its steps, extract it into a named function.

Bad:

```ts
// Calculate the ROI by multiplying saved hours with loaded hourly cost
const roi = hoursSaved * employee.loadedHourlyCost;
```

Good:

```ts
const roi = calculateSalaryCalibratedRoi(hoursSaved, employee.loadedHourlyCost);
```

## Comment Style

When a comment is necessary:

- Keep it short.
- Explain why, not what.
- Put it directly above the relevant code.
- Use plain language.
- Delete it if the code changes and the comment no longer applies.

Good:

```ts
// Network logs can arrive late, so use the session timestamp instead of ingestion time.
const lastUsedAt = latestSignal.sessionStartedAt;
```

Bad:

```ts
// This gets the last used at date from the latest signal object.
const lastUsedAt = latestSignal.sessionStartedAt;
```

## TODO Comments

Avoid vague TODOs.

Bad:

```ts
// TODO: fix this later
```

Acceptable:

```ts
// TODO: Replace mock risk thresholds with backend-provided policy config.
```

Every TODO should name the missing decision or follow-up clearly.

## React-Specific Guidance

Do not comment ordinary React structure.

Avoid:

```tsx
// Render loading state
if (isLoading) {
  return <LoadingState />;
}
```

Prefer:

```tsx
if (isLoading) {
  return <LoadingState />;
}
```

Comments are acceptable when explaining product behavior:

```tsx
// Keep dismissed interventions visible to admins so behavior-change outcomes remain auditable.
const visibleInterventions = includeDismissed
  ? interventions
  : interventions.filter((intervention) => intervention.status !== "dismissed");
```

## Final Cleanup Checklist

Before finishing code:

- Remove comments that restate code.
- Remove file banners and section banners.
- Rename unclear variables instead of explaining them.
- Extract complex logic into named functions.
- Keep comments only where they preserve important business, security, or architectural context.
- Re-read comments after edits and delete stale ones.