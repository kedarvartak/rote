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
      { id: "G1", label: "the curve", verdict: "✓ 37.2%", ok: true },
      { id: "G2", label: "the level", verdict: "pending", ok: false },
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
  now: { color: "#c2751f", chip: "← we are here" },
  planned: { color: "#8a8578", chip: "planned" },
};

// static so Tailwind can see them: staircase offsets for row one
const STEP_OFFSET = ["", "lg:mt-12", "lg:mt-24"];
const ELBOW_OFFSET = ["", "", "lg:mt-12"];

type Edge = { dashed: boolean; color: string; delay: number };

/**
 * Connector between steps — drawn with the loom's vocabulary: one smooth
 * thread with horizontal tangents, a soft sweep into the next card, and a
 * small chevron head. Solid = traversed, dashed copper = in flight,
 * dashed grey = planned.
 */
function Connector({ drop, edge, offsetClass = "" }: { drop: boolean; edge: Edge; offsetClass?: string }) {
  const common = {
    stroke: edge.color,
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeDasharray: edge.dashed ? "2 7" : undefined,
  };
  const entrance = edge.dashed
    ? { className: "fadepath" }
    : { className: "drawpath", pathLength: 1 };
  return (
    <div className={`hidden lg:block w-14 shrink-0 relative ${offsetClass}`} aria-hidden>
      {drop ? (
        /* the thread crosses the gap, bends over the next card, and lands its
           tip exactly on that card's top edge (offsets step uniformly, so the
           landing y is the same for every pair) */
        <svg viewBox="0 0 56 40" className="absolute top-4 left-0 w-14 overflow-visible" fill="none">
          <path
            d="M-4 10 H54 Q78 10 78 21 V23"
            style={{ transitionDelay: `${edge.delay}s` }}
            {...entrance}
            {...common}
          />
          <path d="M72 24 L78 32 L84 24" {...common} strokeDasharray={undefined} />
        </svg>
      ) : (
        <svg viewBox="0 0 56 24" className="absolute top-7 left-0 w-14 overflow-visible" fill="none">
          <path
            d="M-4 12 H44"
            style={{ transitionDelay: `${edge.delay}s` }}
            {...entrance}
            {...common}
          />
          <path d="M39 6 L48 12 L39 18" {...common} strokeDasharray={undefined} />
        </svg>
      )}
    </div>
  );
}

/**
 * The return thread from P2 down and across to P3 — the staircase landing.
 * Fixed corner sweeps at both ends, a percentage-width line between them,
 * all dashed grey: this stretch of the path is still planned.
 */
function WrapConnector() {
  const c = "#8a8578";
  return (
    <div className="hidden lg:flex h-16 mt-2" aria-hidden>
      {/* left corner: down into P3 */}
      <div className="w-20 shrink-0 relative">
        <svg viewBox="0 0 80 64" className="absolute inset-0 w-full h-full overflow-visible" fill="none">
          <path
            className="fadepath"
            d="M80 28 H30 C 14 28, 12 34, 12 44 V52"
            stroke={c}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="2 7"
            style={{ transitionDelay: "1.5s" }}
          />
          <path d="M6 47 L12 56 L18 47" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>
      {/* stretch: percentage-width line, same dash voice */}
      <div className="flex-1 relative">
        <svg className="absolute inset-0 w-full h-full" fill="none">
          <line
            className="fadepath"
            x1="0"
            y1="28"
            x2="100%"
            y2="28"
            stroke={c}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="2 7"
            style={{ transitionDelay: "1.3s" }}
          />
        </svg>
      </div>
      {/* right corner: receives the stub falling from P2 and turns left */}
      <div className="w-20 shrink-0 relative">
        <svg viewBox="0 0 80 64" className="absolute inset-0 w-full h-full overflow-visible" fill="none">
          <path
            className="fadepath"
            d="M42 0 C 42 18, 38 28, 22 28 H0"
            stroke={c}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeDasharray="2 7"
            style={{ transitionDelay: "1.1s" }}
          />
        </svg>
      </div>
    </div>
  );
}

function PhaseCard({ p, fill = false }: { p: (typeof PHASES)[number]; fill?: boolean }) {
  const s = STATE[p.state];
  return (
    <article
      className={`${fill ? "h-full" : ""} border bg-white/40 ${
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
              <div
                key={g.id}
                className="flex items-baseline justify-between gap-3 font-mono text-[0.66rem] whitespace-nowrap"
              >
                <span className="text-paper-ink/70">
                  {g.id} · {g.label}
                </span>
                <span className={g.ok ? "text-[#4c8f58]" : "text-paper-ink/40"}>
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

/**
 * Dark rail: the phase loom. Every curve leaves one trunk point on the left —
 * placed level with the current phase — and fans out to its phase with
 * horizontal tangents at both ends, so the bundle converges the way a wiring
 * loom does. The current row is lit; everything else recedes.
 */
const ROW_PITCH = 46;
const RAIL_TOP = 14;
const TRUNK_X = 6;
const DOT_X = 72;

function Rail() {
  const items = PHASES.map((p, i) => ({ ...p, y: RAIL_TOP + i * ROW_PITCH }));
  const trunkY = items.find((p) => p.state === "now")!.y;
  const curveColor = (p: (typeof PHASES)[number], i: number) => {
    if (p.state === "now") return { stroke: "#d98f3d", opacity: 1 };
    if (p.state === "done") return { stroke: "#4c8f58", opacity: 0.75 };
    // planned: copper fading with distance, last one bone like a loose thread
    if (i === PHASES.length - 1) return { stroke: "#a9a69b", opacity: 0.55 };
    return { stroke: "#c2751f", opacity: 0.5 - (i - 2) * 0.08 };
  };
  return (
    <div className="hidden lg:block" aria-hidden>
      <svg
        viewBox="0 0 250 260"
        className="w-full max-w-[250px] h-auto overflow-visible"
        fill="none"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {items.map((p, i) => {
          const c = curveColor(p, i);
          const current = p.state === "now";
          return (
            <g key={p.id}>
              <path
                className="drawpath"
                d={`M${TRUNK_X} ${trunkY} C ${TRUNK_X + 34} ${trunkY}, ${DOT_X - 38} ${p.y}, ${DOT_X - 6} ${p.y}`}
                stroke={c.stroke}
                strokeOpacity={c.opacity}
                strokeWidth={current ? 1.8 : 1.4}
                pathLength={1}
                style={{ transitionDelay: `${0.15 + i * 0.09}s` }}
              />
              <rect
                x={DOT_X - 3}
                y={p.y - (current ? 4 : 3)}
                width={current ? 8 : 6}
                height={current ? 8 : 6}
                fill={c.stroke}
                fillOpacity={current ? 1 : Math.min(1, c.opacity + 0.15)}
              />
              <text
                x={DOT_X + 14}
                y={p.y + 3.5}
                fontSize="10.5"
                letterSpacing="1.7"
                fill={current ? "#e8e2d6" : "#7e7d75"}
                fontWeight={current ? 500 : 400}
              >
                {`${p.id} · ${p.theme.toUpperCase()}`}
              </text>
            </g>
          );
        })}
      </svg>
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

          {/* staircase row one: P0 → P2, stepping down; solid = traversed, dashed = in flight */}
          <div className="flex flex-col gap-4 lg:flex-row lg:gap-0 lg:items-stretch">
            {row1.map((p, i) => (
              <div key={p.id} className="contents">
                {i > 0 && (
                  <Connector
                    drop
                    offsetClass={ELBOW_OFFSET[i]}
                    edge={
                      i === 1
                        ? { dashed: false, color: "#c2751f", delay: 0.5 }
                        : { dashed: true, color: "#c2751f", delay: 0.75 }
                    }
                  />
                )}
                <div
                  className={`lg:flex-1 min-w-0 ${STEP_OFFSET[i]} ${
                    i === row1.length - 1 ? "lg:self-stretch lg:flex lg:flex-col" : ""
                  }`}
                >
                  <PhaseCard p={p} />
                  {/* exit stub: falls from P2's bottom edge to the row's floor,
                      where the wrap corner picks it up — survives any card height */}
                  {i === row1.length - 1 && (
                    <div className="hidden lg:block grow relative min-h-4" aria-hidden>
                      <svg className="absolute inset-y-0 right-0 w-[76px] h-full" fill="none">
                        <line
                          className="fadepath"
                          x1="38"
                          y1="0"
                          x2="38"
                          y2="100%"
                          stroke="#8a8578"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeDasharray="2 7"
                          style={{ transitionDelay: "0.95s" }}
                        />
                      </svg>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* the landing: a return thread from P2 down to P3 */}
          <WrapConnector />

          {/* row two: P3 → P5, the level shelf — still planned, still dashed */}
          <div className="mt-4 lg:mt-0 flex flex-col gap-4 lg:flex-row lg:gap-0 lg:items-stretch">
            {row2.map((p, i) => (
              <div key={p.id} className="contents">
                {i > 0 && (
                  <Connector
                    drop={false}
                    edge={{ dashed: true, color: "#8a8578", delay: 1.7 + i * 0.2 }}
                  />
                )}
                <div className="lg:flex-1 min-w-0">
                  <PhaseCard p={p} fill />
                </div>
              </div>
            ))}
          </div>
        </div>
      </Reveal>
    </div>
  );
}
