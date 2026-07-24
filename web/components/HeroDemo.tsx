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

export function HeroDemo() {
  const [tick, setTick] = useState(0);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) {
      setTick(N);
      return;
    }
    const id = setInterval(
      () => setTick((t) => (t >= N + PAUSE_TICKS ? 0 : t + 1)),
      TICK_MS,
    );
    return () => clearInterval(id);
  }, []);

  const step = Math.min(tick, N);
  const done = step === N;

  return (
    <figure aria-label="Animation: the same nine-step task. An ordinary agent re-reads every earlier page at every step, 45 page-reads in total. Rote keeps a note per step and reads only the current page, 9 page-reads in total.">
      <div className="grid gap-4 lg:grid-cols-2">
        {/* ordinary agent */}
        <div className="rounded-sm border hairline bg-surface p-5">
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-[0.95rem] text-ink">An ordinary agent</p>
            <p className="font-mono text-[0.65rem] tracking-widest uppercase text-blue-bright">
              re-reads everything, every step
            </p>
          </div>
          <div className="mt-4 space-y-1.5" style={{ minHeight: `${N * 1.06}rem` }}>
            {Array.from({ length: step }, (_, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="font-mono text-[0.6rem] text-muted w-10 shrink-0 tabular-nums">
                  step {i + 1}
                </span>
                <div
                  className="h-2.5 rounded-[2px] bg-blue/65 transition-all duration-700 ease-out"
                  style={{ width: `${((i + 1) / N) * 88}%` }}
                />
              </div>
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
          <div className="flex items-baseline justify-between gap-4">
            <p className="text-[0.95rem] text-ink">The same task with Rote</p>
            <p className="font-mono text-[0.65rem] tracking-widest uppercase text-copper-bright">
              keeps notes, reads only what changed
            </p>
          </div>
          <div className="mt-4 space-y-1.5" style={{ minHeight: `${N * 1.06}rem` }}>
            {Array.from({ length: step }, (_, i) => (
              <div key={i} className="flex items-center gap-2.5">
                <span className="font-mono text-[0.6rem] text-muted w-10 shrink-0 tabular-nums">
                  step {i + 1}
                </span>
                <div className="h-2.5 w-[9%] rounded-[2px] bg-copper/80" />
                <span className="font-mono text-[0.6rem] text-copper-bright/80">
                  note
                </span>
              </div>
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
          <span className="text-ink-2">That gap grows with every step — measured at 37.2% below.</span>
        </span>
      </figcaption>
    </figure>
  );
}
