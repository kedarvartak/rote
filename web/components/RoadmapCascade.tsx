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

/**
 * Dark rail: the phase arc as an append-only log — a single spine, solid
 * where committed, dashed where still planned, with the P1 exit gates drawn
 * as tick-gates on the line itself (the line does not continue until a
 * number passes them). Node = memory cell; the current cell breathes.
 */
const RAIL_Y = { P0: 18, P1: 64, G1: 96, G2: 118, P2: 152, P3: 196, P4: 240, P5: 284 };

function Rail() {
  const label = (p: (typeof PHASES)[number]) =>
    p.state === "now" ? "#d98f3d" : p.state === "done" ? "#a9a69b" : "#7e7d75";
  return (
    <div className="hidden lg:block" aria-hidden>
      <svg
        viewBox="0 0 250 306"
        className="w-full max-w-[250px] h-auto overflow-visible"
        fill="none"
        style={{ fontFamily: "var(--font-mono)" }}
      >
        {/* spine: committed (solid) → current → gated (dashed until G2 passes) */}
        <path
          className="drawpath"
          d={`M10 ${RAIL_Y.P0} V${RAIL_Y.P1}`}
          stroke="#4c8f58"
          strokeWidth="1.5"
          pathLength={1}
        />
        <path
          className="drawpath"
          d={`M10 ${RAIL_Y.P1} V${RAIL_Y.G1 - 5}`}
          stroke="#c2751f"
          strokeWidth="1.5"
          pathLength={1}
          style={{ transitionDelay: "0.45s" }}
        />
        <path
          className="drawpath"
          d={`M10 ${RAIL_Y.G1 + 5} V${RAIL_Y.G2 - 5}`}
          stroke="#c2751f"
          strokeWidth="1.5"
          strokeOpacity="0.55"
          pathLength={1}
          style={{ transitionDelay: "0.65s" }}
        />
        <path
          className="drawpath"
          d={`M10 ${RAIL_Y.G2 + 5} V${RAIL_Y.P5}`}
          stroke="#7e7d75"
          strokeOpacity="0.5"
          strokeWidth="1.3"
          strokeDasharray="3 5"
          pathLength={1}
          style={{ transitionDelay: "0.85s" }}
        />

        {/* phase nodes + labels */}
        {PHASES.map((p) => {
          const y = RAIL_Y[p.id as keyof typeof RAIL_Y];
          const s = STATE[p.state];
          const current = p.state === "now";
          return (
            <g key={p.id}>
              {current && (
                <rect
                  x={3}
                  y={y - 7}
                  width={14}
                  height={14}
                  stroke="#c2751f"
                  strokeWidth="1"
                  className="pulse-ring"
                />
              )}
              <rect
                x={current ? 6.5 : 7.5}
                y={current ? y - 3.5 : y - 2.5}
                width={current ? 7 : 5}
                height={current ? 7 : 5}
                fill={s.color}
                fillOpacity={p.state === "planned" ? 0.4 : 1}
                stroke={p.state === "planned" ? s.color : "none"}
                strokeOpacity="0.6"
              />
              <text
                x={30}
                y={y + 3.5}
                fontSize="10.5"
                letterSpacing="1.6"
                fill={label(p)}
                fontWeight={current ? 500 : 400}
              >
                {`${p.id} · ${p.theme.toUpperCase()}`}
              </text>
              {current && (
                <text x={30} y={y + 17} fontSize="8.5" letterSpacing="1.4" fill="#7e7d75">
                  ← YOU ARE HERE
                </text>
              )}
            </g>
          );
        })}

        {/* the two exit gates, drawn on the line */}
        <g>
          <path d={`M4 ${RAIL_Y.G1} H16`} stroke="#4c8f58" strokeWidth="1.5" />
          <text x={30} y={RAIL_Y.G1 + 3} fontSize="8.5" letterSpacing="1.4" fill="#4c8f58">
            G1 · THE CURVE · PASS 37.2%
          </text>
        </g>
        <g>
          <path d={`M4 ${RAIL_Y.G2} H16`} stroke="#7e7d75" strokeWidth="1.5" strokeOpacity="0.7" />
          <text x={30} y={RAIL_Y.G2 + 3} fontSize="8.5" letterSpacing="1.4" fill="#7e7d75">
            G2 · THE LEVEL · NOT YET RUN
          </text>
        </g>
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
