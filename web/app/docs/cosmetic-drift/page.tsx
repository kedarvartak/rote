import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cosmetic drift",
  description:
    "Why a full visual redesign costs Rote's diff-based observations ~6 tokens: the distiller's information bottleneck, the drift gradient, the failure ladder, and the opacity bug the question surfaced.",
};

/* ---------------------------------------------------------------- shells */

function Code({ children }: { children: React.ReactNode }) {
  return (
    <pre className="mt-4 rounded-sm border hairline bg-surface p-4 overflow-x-auto font-mono text-[0.72rem] leading-relaxed text-ink-2">
      {children}
    </pre>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-14 font-display text-2xl tracking-tight">{children}</h2>
  );
}

/* ------------------------------------------------------------------ data */

const GRADIENT = [
  {
    change: "Restyle: classes, stylesheets, colors, fonts, spacing",
    sees: "Nothing. The distiller never reads class or CSS.",
    cost: "~6 tokens — a zero-delta diff",
    verdict: "free",
  },
  {
    change: "Visual reordering (CSS order, or DOM moves at the same depth)",
    sees: "Same stable IDs; only the machine-readable order changes.",
    cost: "~6 tokens",
    verdict: "free",
  },
  {
    change: "Translucency, fades, mid-animation opacity",
    sees: "Nothing, since #138. Only a value parsing to exactly 0 is invisible.",
    cost: "~6 tokens",
    verdict: "free",
  },
  {
    change: "Copy tweaks: a button renamed, a placeholder reworded",
    sees: "Identity churn — name feeds the stable ID, so a remove + add.",
    cost: "A few diff lines; cross-run resolution falls back toward selector hints",
    verdict: "degrades",
  },
  {
    change: "Layout restructuring: wrapper elements shift DOM depth",
    sees: "The ancestry bucket flips for about half the nodes.",
    cost: "One bounded re-snapshot (median 9.3K chars in G1 data), then diffs resume",
    verdict: "degrades",
  },
  {
    change: "A restyle duplicates an interactive element's role + name",
    sees: "ObservationIdentityError — refused, never guessed at.",
    cost: "The run fails closed and falls back to the plain agent",
    verdict: "fails closed",
  },
];

const TRANSCRIPT = `$ npx tsx scripts/demo/cosmetic-diff-demo.ts

=== Step 1: grounded observation (mode=bootstrap, the diff base) ===
- [0a0eab9ca97781a3] heading "Vendor registration"
* [43b1171e7d0e7748] textbox #company "Company name"
* [f611d7df7dd6e00d] combobox #country "Country"
* [6c356500acbb7b0f] button #submit "Submit registration"
- [1dbac07d393d2874] p "All fields are required."
[260 chars, ~65 tokens]

=== Step 2: after the full cosmetic redesign (mode=diff) ===
(no observation changes)
[24 chars, ~6 tokens — identical stable IDs: true]

=== Step 3: a real change (new required field) inside another restyle ===
(mode=diff)
+ * [57690cb72562634c] textbox #tax "Tax ID"
[~11 tokens — the restyle is silent, the new control is not]`;

/* ------------------------------------------------------------------ page */

export default function CosmeticDriftPage() {
  return (
    <article className="pb-20">
      <p className="eyebrow">deep dive</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">
        Cosmetic drift and the diff
      </h1>
      <p className="mt-5 text-ink-2 leading-relaxed max-w-2xl">
        A fair question from the field: if observations are diff-encoded
        against a previous snapshot, doesn&apos;t a visual redesign break the
        diff — or worse, flood it? The answer is that cosmetic drift is the
        case this architecture handles <em>best</em>, and not by detection or
        self-healing. It&apos;s handled by construction: the diff never sees a
        restyle, because the layer below it already threw the styling away.
      </p>

      <H2>The information bottleneck</H2>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        Before anything is diffed, a captured page passes through{" "}
        <span className="font-mono text-[0.8rem]">distillPage</span> in{" "}
        <span className="font-mono text-[0.8rem]">@rote/perception</span>. A
        distilled node keeps seven things: role, accessible name, tag, an
        optional selector hint, DOM depth, interactivity, and checked state.
        The <span className="font-mono text-[0.8rem]">class</span> attribute is
        never read. External CSS does not exist at this layer. Inline style is
        consulted only to decide visibility. Everything a designer touches in a
        reskin is discarded one stage before the diff runs — so the diff
        cannot be confused by what it never receives.
      </p>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        Element identity is a 16-hex-char hash of role, name, and a bucketed
        ancestry depth — deliberately <em>excluding</em> selector hints, ids,
        and styling, so an id rename or restyle cannot change who an element
        is:
      </p>
      <Code>{`// packages/perception/src/distill.ts
function stableId(element, role, name) {
  const ancestryBucket = Math.floor(element.depth / 2);
  // Selector hints are deliberately excluded: IDs must survive an
  // id/name attribute rename so the action resolver can recover
  // through the semantic fallback chain (docs/02 C2).
  return { hash: sha256(\`\${role}\\0\${name}\\0\${ancestryBucket}\`).slice(0, 16) };
}`}</Code>

      <H2>Run it yourself</H2>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        This is the production pipeline — the same{" "}
        <span className="font-mono text-[0.8rem]">
          distillPage → renderAdaptiveObservation
        </span>{" "}
        path the agent runs, no mocks, no API key — on three versions of one
        page: the original, a full redesign (new utility classes on every
        element, inline fonts and colors, a translucent button), and a second
        restyle hiding a genuinely new required field:
      </p>
      <Code>{TRANSCRIPT}</Code>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        The redesign costs six tokens. The real change costs eleven, and
        surfaces as exactly the one line that matters. The demo lives at{" "}
        <span className="font-mono text-[0.8rem]">
          scripts/demo/cosmetic-diff-demo.ts
        </span>{" "}
        — the page HTML is inline, so edit it and rerun to try your own
        drift.
      </p>

      <H2>The drift gradient</H2>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        &ldquo;Cosmetic&rdquo; is a spectrum, and honesty about where it stops
        being free matters more than the headline. What each change looks like
        from inside the pipeline:
      </p>
      <div className="mt-6 grid gap-3">
        {GRADIENT.map((row) => (
          <div
            key={row.change}
            className="rounded-sm border hairline bg-surface p-4 grid gap-2 sm:grid-cols-[1fr_auto] sm:items-start"
          >
            <div>
              <p className="text-[0.85rem] text-ink-2 leading-relaxed">
                {row.change}
              </p>
              <p className="mt-1.5 text-[0.78rem] text-muted leading-relaxed">
                What the diff sees: {row.sees}
              </p>
              <p className="mt-1 font-mono text-[0.68rem] text-copper-bright">
                {row.cost}
              </p>
            </div>
            <span className="font-mono text-[0.6rem] uppercase tracking-widest text-muted border hairline rounded-[2px] px-1.5 py-0.5 justify-self-start sm:justify-self-end">
              {row.verdict}
            </span>
          </div>
        ))}
      </div>
      <p className="mt-6 text-ink-2 leading-relaxed max-w-2xl">
        The pattern across the gradient: cosmetic drift degrades{" "}
        <em>cost</em>, never <em>correctness</em>. The failure ladder is diff →
        identity churn → one bounded re-snapshot under an explicit ceiling →
        clean fallback to the plain agent. There is no rung where the system
        acts on a stale picture of the page — that is design invariant #1
        (never silently wrong) meeting invariant #2 (never worse than
        baseline).
      </p>

      <H2>The bug the question found</H2>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        Auditing this claim against the code surfaced one place a cosmetic
        change genuinely broke observation. Visibility gating
        substring-matched inline styles — and{" "}
        <span className="font-mono text-[0.8rem]">
          &quot;opacity:0.5&quot;
        </span>{" "}
        contains{" "}
        <span className="font-mono text-[0.8rem]">&quot;opacity:0&quot;</span>.
        A merely translucent control — a mid-fade animation frame, a cosmetic
        dimming — silently vanished from the distilled observation and
        surfaced as a spurious removal in the next diff: an element reported
        gone while sitting on screen.
      </p>
      <Code>{`// before — a translucent control matches the substring and vanishes
return !style.includes('display:none')
  && !style.includes('visibility:hidden')
  && !style.includes('opacity:0');   // "opacity:0.5" matches

// after (#138) — parse, and fail open on anything unparseable
const opacity = /(?:^|;)opacity:([^;]+)/.exec(style);
return opacity === null || Number.parseFloat(opacity[1]) !== 0;`}</Code>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        Only a value parsing to exactly 0 (including{" "}
        <span className="font-mono text-[0.8rem]">0%</span>) is treated as
        invisible; anything unparseable stays visible, because dropping a real
        control is the dangerous direction. The fix landed with a regression
        fixture covering{" "}
        <span className="font-mono text-[0.8rem]">0.37</span>,{" "}
        <span className="font-mono text-[0.8rem]">.5</span>,{" "}
        <span className="font-mono text-[0.8rem]">0</span>, and{" "}
        <span className="font-mono text-[0.8rem]">0%</span> in the same PR
        (#138), per the project rule that every manually-found bug becomes an
        automated test in the PR that fixes it.
      </p>

      <H2>Where the hard problem actually is</H2>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        Cosmetic drift is the easy half, and it&apos;s easy for a structural
        reason: the bottleneck discards exactly what cosmetic changes touch.
        The corollary is that every real robustness hole lives where a signal{" "}
        <em>crosses</em> the bottleneck. Structural drift — an{" "}
        <span className="font-mono text-[0.8rem]">&lt;input&gt;</span> becoming
        a <span className="font-mono text-[0.8rem]">&lt;textarea&gt;</span>, a
        button gaining{" "}
        <span className="font-mono text-[0.8rem]">disabled</span> — fails in
        the opposite direction: both distill to the same role today, the tag
        is not part of identity, and the swap is invisible rather than noisy.
        The planned fix keeps affordances (entry mode, disabled, readonly,
        value type) as a channel separate from identity, checked as
        action-conditioned preconditions: input→textarea passes under a bare
        fill, where it genuinely is equivalent, and fails the moment a step
        depends on Enter submitting. Functional equivalence is relative to the
        action — under-observation and over-observation fail in opposite
        directions, and the stable-ID hash is the dial between them.
      </p>
    </article>
  );
}
