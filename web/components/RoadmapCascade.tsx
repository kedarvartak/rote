import { Reveal } from "@/components/Reveal";
import Link from "next/link";

/**
 * The roadmap as a stepped cascade (see docs/05-roadmap.md §The phase arc):
 * a dark branching rail indexes the six phases by state, and a paper panel
 * carries them as stair-stepped cards joined by elbow connectors — the arc
 * reads left-to-right, top-to-bottom, one gate at a time.
 */
const PHASES = [
  {
    id: "P0",
    theme: "Foundations",
    line: "Recorder, verified replay, the sacred invariant suite.",
    target: "shipped",
    state: "done" as const,
  },
  {
    id: "P1",
    theme: "Working memory",
    line: "“The first browser agent with a managed context window.”",
    target: "2026 Q3",
    state: "now" as const,
    gates: [
      { id: "G1", label: "the curve", verdict: "pass · 37.2%", ok: true },
      { id: "G2", label: "the level", verdict: "not yet run", ok: false },
    ],
  },
  {
    id: "P2",
    theme: "The harness that learns",
    line: "“Your 50th task on a site costs a fraction of your 1st.”",
    target: "2026 Q4",
    state: "planned" as const,
  },
  {
    id: "P3",
    theme: "Speculation",
    line: "“Warm flows bounded by think-time only.”",
    target: "2027 Q1",
    state: "planned" as const,
  },
  {
    id: "P4",
    theme: "Fleet & enterprise",
    line: "“10K tasks a day, audited, lowest $ per task.”",
    target: "2027 Q2–Q3",
    state: "planned" as const,
  },
  {
    id: "P5",
    theme: "Platform",
    line: "“The efficiency substrate other agents build on.”",
    target: "2027 Q4+",
    state: "planned" as const,
  },
];

const STATE = {
  done: { color: "#4c8f58", chip: "done" },
  now: { color: "#c2751f", chip: "← you are here" },
  planned: { color: "#8a8578", chip: "planned" },
};

// static so Tailwind can see them: staircase offsets for row one
const STEP_OFFSET = ["", "lg:mt-12", "lg:mt-24"];
const ELBOW_OFFSET = ["", "", "lg:mt-12"];

/** Connector between steps: an elbow dropping into the next card (row one) or a flat arrow (row two). */
function Connector({ drop, offsetClass = "" }: { drop: boolean; offsetClass?: string }) {
  return (
    <div className={`hidden lg:block w-11 shrink-0 relative ${offsetClass}`} aria-hidden>
      {drop ? (
        <svg viewBox="0 0 44 72" className="absolute top-4 left-0 w-11 overflow-visible" fill="none">
          <path
            className="drawpath"
            d="M-2 8 H26 Q36 8 36 18 V56"
            stroke="#c2751f"
            strokeWidth="1.5"
            pathLength={1}
          />
          <path d="M31 51 L36 58 L41 51" stroke="#c2751f" strokeWidth="1.5" />
        </svg>
      ) : (
        <svg viewBox="0 0 44 24" className="absolute top-8 left-0 w-11 overflow-visible" fill="none">
          <path className="drawpath" d="M-2 12 H38" stroke="#c2751f" strokeWidth="1.5" pathLength={1} />
          <path d="M33 7 L40 12 L33 17" stroke="#c2751f" strokeWidth="1.5" />
        </svg>
      )}
    </div>
  );
}

function PhaseCard({ p }: { p: (typeof PHASES)[number] }) {
  const s = STATE[p.state];
  return (
    <article
      className={`h-full border bg-white/40 ${
        p.state === "now"
          ? "border-copper/70 shadow-[0_2px_24px_rgba(194,117,31,0.16)]"
          : "border-paper-ink/15"
      }`}
    >
      <div
        className="flex items-center justify-between px-4 py-2.5 border-b border-paper-ink/15"
        style={{
          background: `repeating-linear-gradient(45deg, ${s.color}14 0 6px, transparent 6px 12px)`,
        }}
      >
        <span
          className="font-mono text-[0.8rem] font-medium border px-1.5 py-0.5 bg-paper"
          style={{ color: s.color, borderColor: `${s.color}66` }}
        >
          {p.id}
        </span>
        <span
          className="font-mono text-[0.62rem] tracking-[0.15em] uppercase"
          style={{ color: s.color }}
        >
          {s.chip}
        </span>
      </div>
      <div className="p-4">
        <h3 className="font-medium text-paper-ink text-[1.02rem]">{p.theme}</h3>
        <p className="mt-1.5 font-display italic text-[0.95rem] leading-snug text-paper-ink/75">
          {p.line}
        </p>
        <p className="mt-3 font-mono text-[0.68rem] tracking-widest uppercase text-paper-ink/50">
          {p.target}
        </p>
        {p.gates && (
          <div className="mt-3 pt-3 border-t border-paper-ink/10 space-y-1.5">
            {p.gates.map((g) => (
              <div key={g.id} className="flex items-center gap-2 font-mono text-[0.68rem]">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${g.ok ? "bg-[#4c8f58]" : "bg-paper-ink/25"}`}
                />
                <span className="text-paper-ink/80">
                  {g.id} · {g.label}
                </span>
                <span className={g.ok ? "text-[#4c8f58]" : "text-paper-ink/45"}>
                  {g.verdict}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

/** Dark branching rail: the phase loom, lit by state. */
function Rail() {
  const items = PHASES.map((p, i) => ({ ...p, y: 16 + i * 44 }));
  return (
    <div className="hidden lg:block relative" aria-hidden>
      <svg viewBox="0 0 46 248" className="absolute left-0 top-0 h-[248px] w-[46px]" fill="none">
        {items.map((p) => (
          <path
            key={p.id}
            className="drawpath"
            d={`M4 16 C 22 16, 20 ${p.y}, 40 ${p.y}`}
            stroke={STATE[p.state].color}
            strokeOpacity={p.state === "planned" ? 0.3 : 0.85}
            strokeWidth="1.3"
            pathLength={1}
          />
        ))}
        <rect x="1.5" y="13.5" width="5" height="5" fill="#c2751f" />
      </svg>
      <ul className="ml-[52px]">
        {items.map((p) => (
          <li key={p.id} className="flex items-center gap-2.5 h-[44px] first:h-[30px] first:items-start first:pt-[9px]">
            <span
              className={`w-[5px] h-[5px] shrink-0 ${p.state === "now" ? "animate-pulse" : ""}`}
              style={{
                background: STATE[p.state].color,
                opacity: p.state === "planned" ? 0.35 : 1,
              }}
            />
            <span
              className={`font-mono text-[0.66rem] tracking-[0.18em] uppercase whitespace-nowrap ${
                p.state === "now"
                  ? "text-copper-bright"
                  : p.state === "done"
                    ? "text-ink-2"
                    : "text-muted"
              }`}
            >
              {p.id} · {p.theme}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RoadmapCascade() {
  const row1 = PHASES.slice(0, 3);
  const row2 = PHASES.slice(3);
  return (
    <div className="grid gap-12 lg:grid-cols-[17rem_1fr] items-start">
      <Reveal>
        <Rail />
      </Reveal>

      {/* the paper panel — the notebook page the plan is drawn on */}
      <Reveal delay={120}>
        <div className="bg-paper text-paper-ink p-6 sm:p-9 rounded-sm">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-6 mb-10">
            <div>
              <p className="font-display italic text-copper text-xl">
                One phase at a time.
              </p>
              <h3 className="font-display text-3xl sm:text-[2.4rem] leading-tight tracking-tight mt-1">
                Each behind a gate with a number on it.
              </h3>
            </div>
            <Link
              href="/docs/roadmap"
              className="shrink-0 font-mono text-[0.72rem] tracking-[0.15em] uppercase border border-paper-ink/40 px-4 py-2.5 hover:bg-paper-ink hover:text-paper transition-colors"
            >
              Full roadmap →
            </Link>
          </div>

          {/* staircase row one: P0 → P2, stepping down */}
          <div className="flex flex-col gap-4 lg:flex-row lg:gap-0 lg:items-start">
            {row1.map((p, i) => (
              <div key={p.id} className="contents">
                {i > 0 && <Connector drop offsetClass={ELBOW_OFFSET[i]} />}
                <div className={`lg:flex-1 min-w-0 ${STEP_OFFSET[i]}`}>
                  <PhaseCard p={p} />
                </div>
              </div>
            ))}
          </div>

          {/* row two: P3 → P5, the level shelf the staircase lands on */}
          <div className="mt-4 lg:mt-12 flex flex-col gap-4 lg:flex-row lg:gap-0 lg:items-stretch">
            {row2.map((p, i) => (
              <div key={p.id} className="contents">
                {i > 0 && <Connector drop={false} />}
                <div className="lg:flex-1 min-w-0">
                  <PhaseCard p={p} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
