# MODULAR-FRONTEND.md

Guidance for AI coding agents building the React dashboard in this repo.

The goal is modular, maintainable React code with a strict separation between structure, behavior, and styling. The app should feel enterprise-grade: clear information hierarchy, dense but readable dashboard surfaces, predictable interaction patterns, and no decorative clutter.

## Required Brand Source

Before writing UI code, read `BRAND.md`.

Use `BRAND.md` as the source of truth for:

- Fonts and font weights
- Color palette
- Background, surface, border, and text colors
- Spacing rhythm
- Radius values
- Shadows
- Motion preferences
- Button, input, and navigation treatment

Do not invent a competing theme. If `BRAND.md` is missing or incomplete, create a small fallback token set and clearly mark it as temporary in the global style layer.

## Project Structure

Use this shape for React code:

```txt
src/
  global/
    global-styles.ts
    global-utils.ts
    types.ts
    constants.ts
  components/
    ComponentName/
      ComponentName.tsx
      styles.ts
      utils.ts
      types.ts
      index.ts
  pages/
    PageName/
      PageName.tsx
      styles.ts
      utils.ts
      types.ts
      index.ts
  features/
    feature-name/
      components/
      hooks/
      services/
      types.ts
      utils.ts
  hooks/
    useSomething.ts
  services/
    api.ts
    storage.ts
  data/
    mock-data.ts
```

Keep folders small and ownership clear. A component folder should contain everything specific to that component. Shared code should move upward only when at least two places need it.

## Styling Rules

Use Tailwind CSS classes, but never inline long class strings directly in JSX.

All global style primitives must live in:

```txt
src/global/global-styles.ts
```

All component-specific style classes must live in that component's:

```txt
styles.ts
```

Do not use:

```tsx
<div className="rounded-lg border bg-white p-4 shadow-sm">
```

Use:

```tsx
<div className={styles.card}>
```

Where `styles.ts` contains:

```ts
export const styles = {
  card: "rounded-lg border bg-surface p-4 shadow-sm",
};
```

No inline CSS objects:

```tsx
// Do not use
<div style={{ padding: 16 }} />
```

No component-local hardcoded design values that should come from the brand system.

## Global Styles

`src/global/global-styles.ts` should expose reusable primitives derived from `BRAND.md`.

Example:

```ts
export const globalStyles = {
  page: "min-h-screen bg-brand-bg text-brand-text font-sans",
  shell: "mx-auto w-full max-w-7xl px-6 py-6",
  section: "space-y-4",
  card: "rounded-md border border-brand-border bg-brand-surface shadow-sm",
  mutedText: "text-sm text-brand-muted",
  focusRing:
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-focus focus-visible:ring-offset-2",
};
```

Use semantic token names such as `bg-brand-surface`, `text-brand-muted`, and `border-brand-border`. Configure these tokens in Tailwind from `BRAND.md`.

## Brand Injection

Inject the theme from `BRAND.md` at the design-token level, not by scattering values across components.

Preferred approach:

1. Read `BRAND.md`.
2. Add brand tokens to `tailwind.config.js` or `tailwind.config.ts`.
3. Map fonts through Tailwind's `fontFamily`.
4. Define semantic colors such as `brand-bg`, `brand-surface`, `brand-text`, `brand-muted`, `brand-border`, `brand-accent`, `brand-danger`, and `brand-success`.
5. Use those semantic tokens in `global-styles.ts` and component `styles.ts` files.

Example Tailwind mapping:

```ts
theme: {
  extend: {
    fontFamily: {
      sans: ["<font from BRAND.md>", "Inter", "system-ui", "sans-serif"],
    },
    colors: {
      brand: {
        bg: "<background from BRAND.md>",
        surface: "<surface from BRAND.md>",
        text: "<primary text from BRAND.md>",
        muted: "<muted text from BRAND.md>",
        border: "<border from BRAND.md>",
        accent: "<accent from BRAND.md>",
        success: "<success from BRAND.md>",
        danger: "<danger from BRAND.md>",
      },
    },
  },
}
```

If using CSS variables, define them once globally and point Tailwind tokens to those variables.

## Component Rules

Every component gets its own folder:

```txt
components/MetricCard/
  MetricCard.tsx
  styles.ts
  utils.ts
  types.ts
  index.ts
```

`MetricCard.tsx` should contain rendering and event wiring only.

`styles.ts` should contain Tailwind class maps only.

`utils.ts` should contain component-specific formatting or derived calculations.

`types.ts` should contain component props and local type definitions.

`index.ts` should re-export the public component:

```ts
export { MetricCard } from "./MetricCard";
export type { MetricCardProps } from "./types";
```

Do not place multiple unrelated components in one file. Small private subcomponents are acceptable only when they are tightly coupled and not reused elsewhere.

## Utilities

Global utilities belong in:

```txt
src/global/global-utils.ts
```

Use global utilities for generic helpers:

- Date formatting
- Number formatting
- Currency formatting
- Percent formatting
- Class name composition
- Safe parsing
- Generic sorting helpers

Component-specific utilities belong in the component folder's `utils.ts`.

Feature-specific utilities belong inside the relevant `features/<feature-name>/utils.ts`.

Do not duplicate formatting logic across components.

## Data Modeling

Prefer explicit domain types.

For an Oximy-style dashboard, likely entities include:

```ts
type Employee = {
  id: string;
  name: string;
  department: string;
  role: string;
  seniority?: string;
};

type AiTool = {
  id: string;
  name: string;
  category: string;
  approved: boolean;
  riskLevel: "low" | "medium" | "high";
};

type UsageSignal = {
  id: string;
  employeeId: string;
  toolId: string;
  taskType: string;
  sessions: number;
  lastUsedAt: string;
};

type Intervention = {
  id: string;
  employeeId: string;
  currentToolId: string;
  recommendedToolId: string;
  reason: string;
  status: "draft" | "sent" | "accepted" | "dismissed";
};
```

Keep the model close to the product loop:

```txt
Observe usage -> detect opportunity/risk -> recommend intervention -> measure outcome
```

## State Management

Start simple.

Use local React state or a custom hook for small builds. Move to Context or a state library only when state is genuinely shared across distant parts of the tree.

Good pattern:

```txt
features/adoption/hooks/useAdoptionDashboard.ts
```

This hook can own filtering, derived metrics, selected rows, and mock data composition.

Avoid burying business logic inside JSX. Derived values should live in hooks or utilities.

## API and Mock Data

For interview builds, use mock data unless a real API is required.

Put mock data in:

```txt
src/data/mock-data.ts
```

Keep service functions behind a stable interface:

```txt
src/services/adoption-service.ts
```

Even if the service reads mock data, structure it like an API boundary. This makes it easy to explain how the app would move to real backend data.

## UX Guidance

For enterprise dashboards:

- Prioritize scanability over decoration.
- Use compact tables, filters, tabs, and metric cards.
- Show clear empty, loading, and error states.
- Make the next action obvious: review risk, send intervention, approve tool, inspect department, export report.
- Use restrained color. Reserve strong color for status, risk, and primary actions.
- Avoid marketing-style hero sections, oversized copy, and decorative cards.

Recommended dashboard sections:

- Top metric row
- Filter bar
- Main table or review queue
- Detail side panel
- Intervention/action panel
- Measurement/ROI summary

## Accessibility

Use semantic HTML first.

Required practices:

- Buttons for actions, links for navigation.
- Label every input.
- Provide visible focus states through `globalStyles.focusRing`.
- Do not rely on color alone for risk or status.
- Use `aria-label` for icon-only buttons.
- Ensure text contrast follows the brand system.

## Naming

Use precise names.

Good:

```txt
AiToolUsageTable
ShadowAiRiskBadge
InterventionQueue
DepartmentFilter
formatCurrency
calculateAdoptionRate
```

Avoid vague names:

```txt
Card
DataBox
StuffList
handleThing
processData
```

## File Size and Complexity

Prefer small files with clear responsibility.

As a rule of thumb:

- Component files should usually stay under 200 lines.
- Utility files should group related helpers only.
- If a component has many modes, split it into smaller components.
- If a JSX block is hard to scan, extract named child components.

## Import Discipline

Use barrel exports for component folders.

Prefer:

```ts
import { MetricCard } from "@/components/MetricCard";
```

Avoid importing internal files from another component's folder:

```ts
// Avoid
import { styles } from "@/components/MetricCard/styles";
```

Only the component itself should consume its local `styles.ts` and `utils.ts`.

## Testing Guidance

Test the logic that carries product risk:

- Metric calculations
- Filtering and sorting
- Risk scoring
- Intervention recommendation rules
- Formatting for money, time, and percentages

Keep UI tests focused on critical workflows:

- User filters usage by department.
- Admin reviews a risky tool.
- Admin sends an intervention.
- Dashboard updates measured impact.

## Implementation Checklist

Before coding:

- Read `BRAND.md`.
- Identify the primary user and workflow.
- Define the MVP entities and state transitions.
- Create or confirm Tailwind brand tokens.
- Create `src/global/global-styles.ts`.
- Create `src/global/global-utils.ts`.

During coding:

- One folder per component.
- Component styles go in local `styles.ts`.
- Component utilities go in local `utils.ts`.
- Shared utilities go in `global/global-utils.ts`.
- No inline CSS.
- No long Tailwind strings in JSX.
- No hardcoded brand colors or fonts in components.

Before finishing:

- Confirm brand tokens are used consistently.
- Remove unused components, utilities, and mock data.