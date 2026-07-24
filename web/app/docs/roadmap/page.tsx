import type { Metadata } from "next";
import { Reveal } from "@/components/Reveal";

export const metadata: Metadata = {
  title: "Roadmap & status — Rote",
  description:
    "The phase arc from P0 foundations to a P5 platform, with the exit gates drawn on the line — what shipped, what's designed, and what blocks launch.",
};

/* ------------------------------------------------------------------ data */

type Entry =
  | {
      kind: "phase";
      id: string;
      theme: string;
      quote: string;
      tier: string;
      target: string;
      state: "done" | "now" | "planned";
      ships: string[];
    }
  | {
      kind: "gate";
      id: string;
      name: string;
      criterion: string;
      verdict: string;
      ok: boolean;
    };

const ARC: Entry[] = [
  {
    kind: "phase",
    id: "P0",
    theme: "Foundations",
    quote: "Nothing above this is worth building on sand.",
    tier: "—",
    target: "shipped",
    state: "done",
    ships: [
      "Core schemas and the closed Expect DSL — Zod first, types derived",
      "Lossless crash-safe recorder: append-only, fsync per event, blobs over 64KB content-addressed",
      "Verified replay executor — deterministic steps at zero LLM tokens, every expect re-checked",
      "The sacred invariant suite touching every executor exit path",
    ],
  },
  {
    kind: "phase",
    id: "P1",
    theme: "Working memory — tier 0",
    quote: "The first browser agent with a managed context window.",
    tier: "0",
    target: "2026 Q3",
    state: "now",
    ships: [
      "A11 observation eviction — kills the dominant quadratic term",
      "A4 diff observations — 849 diffs in G1, median 24 chars, −99.6% vs re-send",
      "B3 cache-layout discipline — immutable prefix routed through prompt_cache_key, 20.5% cost cut at WP-N25",
      "Launch package: the npx quickstart, the README number, the demo",
    ],
  },
  {
    kind: "gate",
    id: "G1",
    name: "the curve",
    criterion:
      "Cumulative logical input must grow materially slower with task length — a public ≥30% floor, CI-bounded, at success parity.",
    verdict: "PASS — 37.2% [35.6–38.8], 75/75 verified",
    ok: true,
  },
  {
    kind: "gate",
    id: "G2",
    name: "the level",
    criterion:
      "A tokens-per-task win at success parity — at least 15 runs, seeded-bootstrap lower bound above the floor.",
    verdict: "NOT YET RUN",
    ok: false,
  },
  {
    kind: "phase",
    id: "P2",
    theme: "The harness that learns — tiers 1 & 2",
    quote: "Your 50th task on a site costs a fraction of your 1st.",
    tier: "1 · 2",
    target: "2026 Q4",
    state: "planned",
    ships: [
      "Playbook distiller — trajectories become verified playbooks",
      "Matcher: semantic match + bind behind the fingerprint gate",
      "Site memory and briefs; B4 history compaction — the lever that makes the curve linear",
    ],
  },
  {
    kind: "phase",
    id: "P3",
    theme: "Speculation",
    quote: "Warm flows bounded by think-time only.",
    tier: "2",
    target: "2027 Q1",
    state: "planned",
    ships: [
      "Transition models learned from recorded runs",
      "Speculative pre-execution with assertion-gated commits",
    ],
  },
  {
    kind: "phase",
    id: "P4",
    theme: "Fleet & enterprise",
    quote: "10K tasks a day, audited, lowest $ per task.",
    tier: "—",
    target: "2027 Q2–Q3",
    state: "planned",
    ships: [
      "Fleet-scale memory administration and audit surfaces",
      "Every replay attributable: who, when, from which verified run",
    ],
  },
  {
    kind: "phase",
    id: "P5",
    theme: "Platform",
    quote: "The efficiency substrate other agents build on.",
    tier: "—",
    target: "2027 Q4+",
    state: "planned",
    ships: ["The memory manager as a surface other harnesses consume"],
  },
];

const BUILT = [
  "Core schemas + the closed Expect DSL (10 primitives)",
  "Lossless, crash-safe recorder",
  "Verified replay executor — zero-LLM deterministic steps",
  "CDP browser backend + fake-world fixture backends",
  "Perception: distill → stable IDs → budget → diffs",
  "A11 observation eviction",
  "A4 diff observations, measured on real pages",
  "B3 cache-layout discipline, economically qualified (T11)",
  "Agent loop with tagged LLM accounting on every call",
  "Benchmark matrix, curve reports, head-to-head launch gate",
  "Action plane: settledness, self-healing resolution, scoped repair",
];

const NOT_BUILT = [
  { what: "B4 history compaction", why: "the lever that would make the curve linear rather than a smaller quadratic — deferred to P2 on purpose" },
  { what: "Playbook distiller", why: "V1 replays hand-written playbooks; trajectory → playbook distillation is unbuilt" },
  { what: "Matcher (semantic match + bind)", why: "only the exact-fingerprint hard gate exists today" },
  { what: "Site memory, model routing, speculation", why: "designed in docs/02, scheduled for P2/P3" },
];

const STATE_COLOR = {
  done: "#5faf6d",
  now: "#d98f3d",
  planned: "#8a877a",
};

/* ------------------------------------------------------------------ page */

export default function RoadmapPage() {
  return (
    <article className="pb-20">
      {/* header */}
      <Reveal>
        <p className="eyebrow">docs/05 · roadmap</p>
        <h1 className="mt-3 font-display text-4xl tracking-tight">The phase arc</h1>
        <p className="mt-5 text-ink-2 leading-relaxed max-w-2xl">
          One phase at a time, each behind an exit gate with a number on it.
          We are late to tier 1 and early to tier 0 — and tier 0 is the wedge
          nobody else builds.
        </p>
        {/* status strip */}
        <div className="mt-6 flex flex-wrap gap-2.5">
          <span className="rounded-sm border border-copper/50 bg-copper/10 px-3 py-1.5 font-mono text-[0.7rem] tracking-widest uppercase text-copper-bright">
            now · P1 working memory
          </span>
          <span className="rounded-sm border border-good/40 px-3 py-1.5 font-mono text-[0.7rem] tracking-widest uppercase text-good">
            G1 pass · 37.2%
          </span>
          <span className="rounded-sm border hairline px-3 py-1.5 font-mono text-[0.7rem] tracking-widest uppercase text-muted">
            G2 pending
          </span>
          <span className="rounded-sm border hairline px-3 py-1.5 font-mono text-[0.7rem] tracking-widest uppercase text-muted">
            target 2026 Q3
          </span>
        </div>
      </Reveal>

      {/* the arc */}
      <div className="mt-14 relative ml-1.5">
        <div className="absolute left-0 top-2 bottom-2 w-px bg-[rgba(232,226,214,0.12)]" aria-hidden />
        <div className="space-y-10">
          {ARC.map((e, i) => (
            <Reveal key={e.id} delay={Math.min(i, 4) * 70}>
              {e.kind === "phase" ? (
                <div className="relative pl-9">
                  {/* node */}
                  <span
                    className="absolute -left-[5.5px] top-2 w-3 h-3"
                    style={{
                      background: e.state === "planned" ? "transparent" : STATE_COLOR[e.state],
                      border: `1.5px solid ${STATE_COLOR[e.state]}`,
                    }}
                    aria-hidden
                  />
                  <div
                    className={`rounded-sm border p-6 ${
                      e.state === "now"
                        ? "border-copper/60 bg-surface shadow-[0_2px_24px_rgba(194,117,31,0.1)]"
                        : "hairline bg-surface/60"
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span
                        className="font-mono text-sm"
                        style={{ color: STATE_COLOR[e.state] }}
                      >
                        {e.id}
                      </span>
                      <h2 className="font-display text-2xl">{e.theme}</h2>
                      <span className="ml-auto font-mono text-[0.66rem] tracking-widest uppercase text-muted">
                        tier {e.tier} · {e.target}
                        {e.state === "now" && (
                          <span className="text-copper-bright"> · ← we are here</span>
                        )}
                        {e.state === "done" && <span className="text-good"> · done</span>}
                      </span>
                    </div>
                    <p className="mt-2.5 font-display text-lg text-ink-2">
                      &ldquo;{e.quote}&rdquo;
                    </p>
                    <ul className="mt-4 space-y-2 text-[0.88rem] text-ink-2 leading-relaxed">
                      {e.ships.map((s) => (
                        <li key={s} className="flex gap-2.5">
                          <span
                            className="mt-[0.55em] w-1 h-1 shrink-0 rounded-full"
                            style={{ background: STATE_COLOR[e.state] }}
                            aria-hidden
                          />
                          <span>{s}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : (
                /* gate: a tick across the spine + verdict card */
                <div className="relative pl-9">
                  <span
                    className="absolute -left-[9px] top-[1.35rem] h-[1.5px] w-5"
                    style={{ background: e.ok ? "#5faf6d" : "#8a877a" }}
                    aria-hidden
                  />
                  <div
                    className={`rounded-sm border px-5 py-4 ${
                      e.ok ? "border-good/40 bg-good/[0.05]" : "hairline bg-surface/40"
                    }`}
                  >
                    <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                      <span className={`font-mono text-sm ${e.ok ? "text-good" : "text-muted"}`}>
                        {e.id} · exit gate · {e.name}
                      </span>
                      <span
                        className={`ml-auto font-mono text-[0.68rem] tracking-widest uppercase ${
                          e.ok ? "text-good" : "text-muted"
                        }`}
                      >
                        {e.verdict}
                      </span>
                    </div>
                    <p className="mt-2 text-[0.85rem] text-ink-2 leading-relaxed max-w-2xl">
                      {e.criterion}
                    </p>
                  </div>
                </div>
              )}
            </Reveal>
          ))}
        </div>
      </div>

      {/* shipped vs on the record */}
      <div className="mt-20 grid gap-10 lg:grid-cols-2">
        <Reveal>
          <h2 className="font-display text-2xl">Built and working end-to-end</h2>
          <ul className="mt-5 space-y-2 text-[0.88rem] text-ink-2 leading-relaxed">
            {BUILT.map((b) => (
              <li key={b} className="flex gap-2.5">
                <span className="text-good mt-0.5">✓</span>
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </Reveal>
        <Reveal delay={100}>
          <h2 className="font-display text-2xl">Not built — on purpose, on the record</h2>
          <p className="mt-3 text-[0.88rem] text-ink-2 leading-relaxed">
            The roadmap rule is executor before distiller — never build ahead
            of the phase. The gaps are part of the ledger:
          </p>
          <div className="mt-4 space-y-3">
            {NOT_BUILT.map((n) => (
              <div key={n.what} className="rounded-sm border hairline bg-surface p-4">
                <p className="font-medium text-[0.9rem]">{n.what}</p>
                <p className="mt-1 text-[0.83rem] text-ink-2 leading-relaxed">{n.why}</p>
              </div>
            ))}
          </div>
        </Reveal>
      </div>

      {/* what blocks launch */}
      <Reveal delay={100}>
        <div className="mt-16 rounded-sm border border-copper/40 bg-copper/[0.06] p-6">
          <p className="font-mono text-[0.68rem] tracking-[0.18em] uppercase text-copper-bright">
            what blocks launch
          </p>
          <p className="mt-3 text-[0.92rem] text-ink-2 leading-relaxed max-w-3xl">
            G1 passed at 37.2%; G2 — the tokens-per-task level win at success
            parity — has not yet run. The packages are private at 0.0.0, so
            the <code className="font-mono text-[0.85em] text-ink">npx rote run</code>{" "}
            quickstart does not exist yet, and there is no public demo. The
            second number isn&apos;t in — and the launch package waits for it.
          </p>
        </div>
      </Reveal>
    </article>
  );
}
