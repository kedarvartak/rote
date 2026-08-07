import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cosmetic drift",
  description:
    "A site redesign costs Rote ~6 tokens. The distiller throws styling away before the diff runs, so cosmetic changes can't break — or bloat — an observation.",
};

/* ---------------------------------------------------------------- shells */

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-16 font-display text-2xl tracking-tight">{children}</h2>
  );
}

function Chip({
  tone,
  children,
}: {
  tone: "keep" | "drop" | "free" | "degrades" | "fails";
  children: React.ReactNode;
}) {
  const tones = {
    keep: "border-copper/50 text-copper-bright",
    drop: "hairline text-muted line-through decoration-muted/60",
    free: "border-copper/50 text-copper-bright",
    degrades: "hairline text-ink-2",
    fails: "hairline text-muted",
  } as const;
  return (
    <span
      className={`inline-flex items-center font-mono text-[0.62rem] uppercase tracking-widest border rounded-[2px] px-1.5 py-0.5 ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ data */

const KEPT = ["role", "name", "tag", "depth", "interactive", "checked"];
const DROPPED = ["class", "CSS", "colors", "fonts", "spacing", "animation"];

const STEPS = [
  {
    label: "Step 1 · first look",
    tokens: "~65 tokens",
    what: "One grounded snapshot of the page. Paid once — this is the diff base.",
  },
  {
    label: "Step 2 · full redesign",
    tokens: "~6 tokens",
    what: "New classes, fonts, colors on every element. The diff: “no observation changes.”",
  },
  {
    label: "Step 3 · a real change",
    tokens: "~11 tokens",
    what: "A new required field, hidden inside another restyle. One diff line — the field.",
  },
];

const GRADIENT = [
  {
    change: "Restyle — classes, CSS, colors, fonts",
    result: "Invisible. The diff never sees styling.",
    cost: "~6 tokens",
    tone: "free" as const,
  },
  {
    change: "Visual reordering",
    result: "Same element identities; only order updates.",
    cost: "~6 tokens",
    tone: "free" as const,
  },
  {
    change: "Fades & translucency",
    result: "Still visible, still tracked.",
    cost: "~6 tokens",
    tone: "free" as const,
  },
  {
    change: "Renamed labels or placeholders",
    result: "Identity changes; resolution falls back to selectors.",
    cost: "a few diff lines",
    tone: "degrades" as const,
  },
  {
    change: "New wrapper layout",
    result: "One bounded re-snapshot, then diffs resume.",
    cost: "one snapshot",
    tone: "degrades" as const,
  },
  {
    change: "Two identical controls appear",
    result: "Refused, never guessed. Falls back to the plain agent.",
    cost: "run falls back",
    tone: "fails" as const,
  },
];

/* ------------------------------------------------------------------ page */

export default function CosmeticDriftPage() {
  return (
    <article className="pb-20">
      <p className="eyebrow">deep dive</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">
        A redesign costs 6 tokens
      </h1>
      <p className="mt-5 text-ink-2 leading-relaxed max-w-2xl">
        Rote sends the model <em>diffs</em> of the page, not the page. So what
        happens when a site restyles everything? Nothing — and not because we
        detect it. The styling is thrown away one layer before the diff runs,
        so a redesign has nothing left to change.
      </p>

      <H2>Watch it happen</H2>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        The production pipeline on three versions of one page — original, fully
        redesigned, and redesigned with a real new field hidden inside:
      </p>
      {/* plain <img>: the GIF is animated, next/image would freeze or bloat it */}
      <img
        src="/cosmetic-diff-demo.gif"
        alt="Terminal demo: a full cosmetic redesign produces the diff “no observation changes” (~6 tokens); a hidden real change surfaces as one diff line (~11 tokens)."
        className="mt-6 w-full rounded-sm border hairline"
      />
      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s) => (
          <div key={s.label} className="rounded-sm border hairline bg-surface p-4">
            <p className="font-mono text-[0.62rem] uppercase tracking-widest text-muted">
              {s.label}
            </p>
            <p className="mt-2 font-display text-2xl text-copper-bright">
              {s.tokens}
            </p>
            <p className="mt-2 text-[0.8rem] text-ink-2 leading-relaxed">
              {s.what}
            </p>
          </div>
        ))}
      </div>

      <H2>How it&apos;s taken care of</H2>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        Before anything is diffed, every page passes through a distiller that
        keeps what an <em>agent</em> needs and drops what a <em>designer</em>{" "}
        touches:
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-sm border border-copper/40 bg-surface p-4">
          <p className="font-mono text-[0.62rem] uppercase tracking-widest text-copper-bright">
            kept — what the agent acts on
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {KEPT.map((k) => (
              <Chip key={k} tone="keep">
                {k}
              </Chip>
            ))}
          </div>
        </div>
        <div className="rounded-sm border hairline bg-surface p-4">
          <p className="font-mono text-[0.62rem] uppercase tracking-widest text-muted">
            dropped — what a redesign touches
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {DROPPED.map((d) => (
              <Chip key={d} tone="drop">
                {d}
              </Chip>
            ))}
          </div>
        </div>
      </div>
      <div className="mt-6 rounded-sm border hairline bg-surface p-4 overflow-x-auto">
        <p className="font-mono text-[0.72rem] leading-relaxed text-ink-2 whitespace-nowrap">
          page&nbsp;&nbsp;→&nbsp;&nbsp;distill{" "}
          <span className="text-muted">(styling dropped here)</span>
          &nbsp;&nbsp;→&nbsp;&nbsp;stable IDs&nbsp;&nbsp;→&nbsp;&nbsp;diff
          &nbsp;&nbsp;→&nbsp;&nbsp;planner
        </p>
      </div>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        Each element&apos;s identity is a hash of what it <em>is</em> — role,
        name, position band — never how it looks and never its selectors. A
        restyled button is still the same button, so the diff has nothing to
        report and replay finds its target without hesitation.
      </p>

      <H2>Where the line is</H2>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        &ldquo;Cosmetic&rdquo; is a spectrum. Here&apos;s the whole of it, and
        what each kind of change costs:
      </p>
      <div className="mt-6 rounded-sm border hairline overflow-x-auto">
        <table className="w-full text-left text-[0.82rem]">
          <thead>
            <tr className="border-b hairline">
              <th className="p-3 font-mono text-[0.62rem] uppercase tracking-widest text-muted font-normal">
                the site changes…
              </th>
              <th className="p-3 font-mono text-[0.62rem] uppercase tracking-widest text-muted font-normal">
                rote&apos;s response
              </th>
              <th className="p-3 font-mono text-[0.62rem] uppercase tracking-widest text-muted font-normal">
                cost
              </th>
            </tr>
          </thead>
          <tbody>
            {GRADIENT.map((row) => (
              <tr key={row.change} className="border-b hairline last:border-b-0">
                <td className="p-3 text-ink-2 align-top">{row.change}</td>
                <td className="p-3 text-ink-2 align-top">{row.result}</td>
                <td className="p-3 align-top whitespace-nowrap">
                  <Chip tone={row.tone}>{row.cost}</Chip>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        The rule across every row: drift can cost tokens, but it can never make
        the agent act on a stale picture of the page. When the system
        isn&apos;t sure, it re-looks or hands off — it doesn&apos;t guess.
      </p>

      <H2>Try it yourself</H2>
      <p className="mt-4 text-ink-2 leading-relaxed max-w-2xl">
        No API key needed. The page HTML is inline in the script — edit the
        &ldquo;redesign&rdquo; and rerun your own drift:
      </p>
      <pre className="mt-4 rounded-sm border hairline bg-surface p-4 overflow-x-auto font-mono text-[0.72rem] leading-relaxed text-ink-2">
        {`git clone https://github.com/kedarvartak/rote && cd rote && npm i
npx tsx scripts/demo/cosmetic-diff-demo.ts`}
      </pre>
      <p className="mt-8 text-[0.8rem] text-muted leading-relaxed max-w-2xl">
        Scope note: this page covers <em>cosmetic</em> drift. Structural drift
        — an input swapped for a textarea, a button disabled — is a different
        problem with its own planned defenses, tracked openly in the roadmap.
      </p>
    </article>
  );
}
