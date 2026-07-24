import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Roadmap & status — Rote",
  description:
    "The phase arc from P0 foundations to a P5 platform, the two exit gates, and exactly what is built versus designed.",
};

const PHASES = [
  {
    id: "P0",
    theme: "Foundations",
    tier: "—",
    headline: "recorder, verified replay, the sacred invariant suite",
    target: "done",
    state: "done" as const,
  },
  {
    id: "P1",
    theme: "V1 · Working memory",
    tier: "0",
    headline: "The first browser agent with a managed context window",
    target: "2026-Q3",
    state: "here" as const,
  },
  {
    id: "P2",
    theme: "V2 · The harness that learns",
    tier: "1, 2",
    headline: "Your 50th task on a site costs a fraction of your 1st",
    target: "2026-Q4",
    state: "planned" as const,
  },
  {
    id: "P3",
    theme: "V3 · Speculation",
    tier: "2",
    headline: "Warm flows bounded by think-time only",
    target: "2027-Q1",
    state: "planned" as const,
  },
  {
    id: "P4",
    theme: "Fleet & enterprise",
    tier: "—",
    headline: "10K tasks/day, audited, lowest $ per task",
    target: "2027-Q2–Q3",
    state: "planned" as const,
  },
  {
    id: "P5",
    theme: "Platform",
    tier: "—",
    headline: "The efficiency substrate other agents build on",
    target: "2027-Q4+",
    state: "planned" as const,
  },
];

const BUILT = [
  "Core schemas + the closed Expect DSL (10 primitives)",
  "Lossless, crash-safe recorder (append-only, fsync per event)",
  "Verified replay executor — deterministic steps cost zero LLM tokens",
  "CDP browser backend + fixture backends for fake-world-first tests",
  "Perception: distill → stable IDs → render budget",
  "A11 observation eviction — kills the dominant quadratic term",
  "A4 diff observations — measured on real pages, median diff 24 chars",
  "B3 cache-layout discipline — economically qualified on OpenAI (T11)",
  "Agent loop with tagged LLM accounting on every call",
  "Benchmark matrix, curve reports, head-to-head launch gate",
  "Action plane: settledness, self-healing resolution, scoped repair",
];

const NOT_BUILT = [
  {
    what: "B4 history compaction",
    why: "the lever that would make the curve linear rather than a smaller quadratic — deliberately deferred to P2",
  },
  {
    what: "Playbook distiller",
    why: "V1 replays hand-written playbooks; trajectory → playbook distillation is unbuilt",
  },
  {
    what: "Matcher (semantic match + bind)",
    why: "only the exact-fingerprint hard gate exists today",
  },
  {
    what: "Site memory, model routing, speculation",
    why: "designed in docs/02, scheduled for P2/P3",
  },
];

export default function RoadmapPage() {
  return (
    <article className="pb-20 max-w-3xl">
      <p className="eyebrow">docs/05 · roadmap</p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">
        Roadmap &amp; status
      </h1>
      <p className="mt-5 text-ink-2 leading-relaxed">
        One phase at a time, each behind an exit gate with a number on it.
        Current phase: <span className="text-ink">P1 — tier 0, working
        memory</span>. We are late to tier 1 and early to tier 0 — and tier 0
        is the wedge nobody else builds.
      </p>

      <div className="mt-8 overflow-x-auto rounded-sm border hairline">
        <table className="w-full text-[0.85rem]">
          <thead className="bg-surface border-b hairline text-left">
            <tr>
              {["Phase", "Theme", "Tier", "Headline", "Target"].map((h) => (
                <th
                  key={h}
                  className="px-3.5 py-2.5 font-mono text-[0.62rem] uppercase tracking-widest text-muted font-normal whitespace-nowrap"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y hairline text-ink-2">
            {PHASES.map((p) => (
              <tr
                key={p.id}
                className={p.state === "here" ? "bg-copper/10" : "hover:bg-surface/70 transition-colors"}
              >
                <td className="px-3.5 py-3 font-mono text-copper-bright whitespace-nowrap">
                  {p.id}
                  {p.state === "here" && <span className="ml-2 text-[0.65rem]">← here</span>}
                  {p.state === "done" && <span className="ml-2 text-[0.65rem] text-good">✓</span>}
                </td>
                <td className="px-3.5 py-3 text-ink whitespace-nowrap">{p.theme}</td>
                <td className="px-3.5 py-3 tabular-nums">{p.tier}</td>
                <td className="px-3.5 py-3 italic font-display">&ldquo;{p.headline}&rdquo;</td>
                <td className="px-3.5 py-3 font-mono text-[0.75rem] whitespace-nowrap">{p.target}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="mt-12 font-display text-2xl">Built and working end-to-end</h2>
      <ul className="mt-4 grid gap-x-8 gap-y-2 sm:grid-cols-2 text-[0.87rem] text-ink-2 leading-relaxed">
        {BUILT.map((b) => (
          <li key={b} className="flex gap-2.5">
            <span className="text-good mt-0.5">✓</span>
            <span>{b}</span>
          </li>
        ))}
      </ul>

      <h2 className="mt-12 font-display text-2xl">Not built — on purpose, on the record</h2>
      <p className="mt-3 text-ink-2 text-[0.9rem] leading-relaxed">
        The roadmap rule is executor before distiller, never build ahead of the
        phase. The docs mark what is designed versus real, and the gaps are
        part of the ledger:
      </p>
      <div className="mt-4 space-y-3">
        {NOT_BUILT.map((n) => (
          <div key={n.what} className="rounded-sm border hairline bg-surface p-4">
            <p className="font-medium text-[0.9rem]">{n.what}</p>
            <p className="mt-1 text-[0.83rem] text-ink-2 leading-relaxed">{n.why}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-12 font-display text-2xl">What blocks launch</h2>
      <p className="mt-3 text-ink-2 text-[0.9rem] leading-relaxed">
        G1 passed at 37.2%; G2 — the tokens-per-task level win at success
        parity — has not yet run. The packages are private at 0.0.0, so the{" "}
        <code className="font-mono text-[0.85em]">npx rote run</code> quickstart
        does not exist yet, and there is no public demo. The motto stands:{" "}
        <span className="text-ink">no number, no launch</span> — and the second
        number isn&apos;t in yet.
      </p>
    </article>
  );
}
