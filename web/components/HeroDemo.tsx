"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The hero demo, built for a first-time visitor: the same nine-step task run
 * twice. Left, an ordinary agent re-reads every page it ever saw at every
 * step — its rows widen into a wedge and the counter races to 45 page-reads.
 * Right, Rote keeps a one-line note per step and reads only the current
 * page — a slim column, 9 page-reads. The shape difference IS the pitch;
 * the math (1+2+…+9 vs 9) comes free.
 */
const N = 9;
const TICK_MS = 1100;
const PAUSE_TICKS = 3;

function pagesSoFar(step: number, everything: boolean) {
  let total = 0;
  for (let s = 1; s <= step; s++) total += everything ? s : 1;
  return total;
}

/**
 * One step's row. Steps that have not run yet still occupy their slot as a
 * faint track: the two panels stack on a phone, and reserving nine rows of
 * blank space in each read as a rendering fault rather than as a run in
 * progress. The ghost also telegraphs the shape each side is heading for —
 * a widening wedge against a fixed column.
 */
function Row({
  i,
  width,
  filled,
  tone,
  note,
}: {
  i: number;
  width: string;
  filled: boolean;
  tone: "blue" | "copper";
  note?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span
        className={`font-mono text-[0.6rem] w-10 shrink-0 tabular-nums transition-colors duration-500 ${
          filled ? "text-muted" : "text-muted/40"
        }`}
      >
        step {i + 1}
      </span>
      <div
        className={`h-2.5 rounded-[2px] transition-all duration-700 ease-out ${
          filled
            ? tone === "blue"
              ? "bg-blue/65"
              : "bg-copper/80"
            : "bg-ink/[0.07]"
        }`}
        style={{ width }}
      />
      {note && (
        <span
          className={`font-mono text-[0.6rem] transition-colors duration-500 ${
            filled ? "text-copper-bright/80" : "text-muted/30"
          }`}
        >
          note
        </span>
      )}
    </div>
  );
}

/** Panel header — side by side on desktop, stacked on a phone where the
 *  descriptor would otherwise wrap into the title. */
function PanelHead({ title, note, tone }: { title: string; note: string; tone: string }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4">
      <p className="text-[0.95rem] text-ink">{title}</p>
      <p className={`font-mono text-[0.65rem] tracking-widest uppercase ${tone}`}>
        {note}
      </p>
    </div>
  );
}

export function HeroDemo() {
  const [tick, setTick] = useState(0);
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTick(N);
      return;
    }
    const el = ref.current;
    if (!el) return;

    // the loop only runs while the figure is on screen — on a phone this sits
    // above a very long page, and a 1.1s interval ticking for the whole scroll
    // costs battery for an animation nobody is watching
    let id: ReturnType<typeof setInterval> | undefined;
    const start = () => {
      if (id) return;
      id = setInterval(
        () => setTick((t) => (t >= N + PAUSE_TICKS ? 0 : t + 1)),
        TICK_MS,
      );
    };
    const stop = () => {
      clearInterval(id);
      id = undefined;
    };
    const io = new IntersectionObserver(
      ([e]) => (e.isIntersecting ? start() : stop()),
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => {
      stop();
      io.disconnect();
    };
  }, []);

  const step = Math.min(tick, N);
  const done = step === N;

  return (
    <figure
      ref={ref}
      aria-label="Animation: the same nine-step task. An ordinary agent re-reads every earlier page at every step, 45 page-reads in total. Rote keeps a note per step and reads only the current page, 9 page-reads in total."
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ordinary agent */}
        <div className="rounded-sm border hairline bg-surface p-5">
          <PanelHead
            title="An ordinary agent"
            note="re-reads everything, every step"
            tone="text-blue-bright"
          />
          <div className="mt-4 space-y-1.5">
            {Array.from({ length: N }, (_, i) => (
              <Row
                key={i}
                i={i}
                width={`${((i + 1) / N) * 88}%`}
                filled={i < step}
                tone="blue"
              />
            ))}
          </div>
          <div className="mt-4 pt-3 border-t hairline flex items-baseline justify-between">
            <span className="text-[0.78rem] text-ink-2">pages re-read so far</span>
            <span className="font-display text-2xl tabular-nums text-blue-bright">
              {pagesSoFar(step, true)}
            </span>
          </div>
        </div>

        {/* rote */}
        <div className="rounded-sm border border-copper/50 bg-surface p-5">
          <PanelHead
            title="The same task with Rote"
            note="keeps notes, reads only what changed"
            tone="text-copper-bright"
          />
          <div className="mt-4 space-y-1.5">
            {Array.from({ length: N }, (_, i) => (
              <Row key={i} i={i} width="9%" filled={i < step} tone="copper" note />
            ))}
          </div>
          <div className="mt-4 pt-3 border-t hairline flex items-baseline justify-between">
            <span className="text-[0.78rem] text-ink-2">pages read so far</span>
            <span className="font-display text-2xl tabular-nums text-copper-bright">
              {pagesSoFar(step, false)}
            </span>
          </div>
        </div>
      </div>
      <figcaption className="mt-3 px-1 flex flex-col sm:flex-row items-start sm:items-baseline justify-between gap-1.5">
        <span className="text-[0.85rem] text-ink-2">
          Same task, same result — step {step} of {N}.
        </span>
        <span
          className={`text-[0.85rem] transition-opacity duration-700 ${
            done ? "opacity-100" : "opacity-0"
          }`}
        >
          <span className="text-ink">45 page-reads vs 9.</span>{" "}
          <span className="text-ink-2">
            That gap grows with every step — measured at 37.2% below.
          </span>
        </span>
      </figcaption>
    </figure>
  );
}
