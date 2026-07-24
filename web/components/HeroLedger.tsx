"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The signature hero animation: two context windows running the same task.
 * Left (append-only harness) keeps every observation it ever saw; right (Rote)
 * evicts prior observations and keeps only the action ledger + the live page.
 * Token math mirrors docs/02-architecture.md §Tier-0 context breakdown:
 * stable prefix ~268 tok, page line ~20 tok, ~37 tok per recorded action,
 * ~135 tok per compact observation.
 */
const STABLE = 268 + 20;
const ACTION_TOK = 37;
const OBS_TOK = 135;
const MAX_STEP = 9;
const TICK_MS = 1300;

const VERBS = [
  "navigate",
  "click",
  "fill",
  "click",
  "select",
  "fill",
  "click",
  "click",
  "done",
];

function promptTokens(step: number, keepsAll: boolean) {
  const obs = keepsAll ? step : Math.min(step, 1);
  return STABLE + step * ACTION_TOK + obs * OBS_TOK;
}

function cumulative(step: number, keepsAll: boolean) {
  let total = 0;
  for (let s = 1; s <= step; s++) total += promptTokens(s, keepsAll);
  return total;
}

function Column({
  title,
  step,
  keepsAll,
  accent,
}: {
  title: string;
  step: number;
  keepsAll: boolean;
  accent: boolean;
}) {
  // newest-first under the pinned prefix, so the window visibly fills and
  // older entries overflow out of view — the "garbage dump" made visual
  const blocks: { kind: "action" | "obs"; label: string; dead: boolean }[] = [];
  for (let s = step; s >= 1; s--) {
    blocks.push({ kind: "action", label: VERBS[s - 1], dead: false });
    blocks.push({
      kind: "obs",
      label: "observation",
      dead: !keepsAll && s < step,
    });
  }
  const perCall = step === 0 ? 0 : promptTokens(step, keepsAll);
  const cum = cumulative(step, keepsAll);

  return (
    <div className="flex-1 min-w-0">
      <div className="flex items-baseline justify-between gap-2 mb-2">
        <span
          className={`font-mono text-[0.62rem] sm:text-[0.68rem] tracking-widest uppercase ${
            accent ? "text-copper-bright" : "text-blue-bright"
          }`}
        >
          {title}
        </span>
        <span className="font-mono text-[0.62rem] text-muted tabular-nums">
          {perCall.toLocaleString()} tok/call
        </span>
      </div>
      <div
        className={`rounded-sm border p-1.5 sm:p-2 flex flex-col gap-1 overflow-hidden bg-surface/70 relative ${
          accent ? "border-copper/40" : "border-blue/30"
        }`}
        style={{ height: "19rem" }}
      >
        {/* stable prefix — never mutates */}
        <div className="rounded-[2px] border border-dashed hairline px-2 py-1 font-mono text-[0.6rem] text-muted">
          system · task · tools <span className="opacity-70">— immutable</span>
        </div>
        {blocks.map((b, i) => (
          <div
            key={i}
            className={`rounded-[2px] font-mono text-[0.6rem] px-2 transition-all duration-700 ease-out ${
              b.kind === "action"
                ? "py-0.5 bg-copper/25 text-copper-bright border border-copper/30"
                : b.dead
                  ? "max-h-0 py-0 opacity-0 border-0 overflow-hidden"
                  : "py-2 bg-blue/15 text-blue-bright/90 border border-blue/25 max-h-12"
            }`}
          >
            {b.kind === "action" ? b.label : `${b.label} · ~135 tok`}
          </div>
        ))}
        {/* fade where older entries overflow the window */}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-10"
          style={{
            background: "linear-gradient(to bottom, transparent, #0d0e10)",
          }}
        />
      </div>
      <div className="mt-2 flex items-baseline justify-between">
        <span className="text-[0.68rem] text-muted">cumulative sent</span>
        <span
          className={`font-mono tabular-nums text-sm ${accent ? "text-copper-bright" : "text-blue-bright"}`}
        >
          {cum.toLocaleString()} tok
        </span>
      </div>
    </div>
  );
}

export function HeroLedger() {
  const [step, setStep] = useState(0);
  const reduced = useRef(false);

  useEffect(() => {
    reduced.current = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced.current) {
      setStep(MAX_STEP);
      return;
    }
    const id = setInterval(() => {
      setStep((s) => (s >= MAX_STEP + 1 ? 0 : s + 1));
    }, TICK_MS);
    return () => clearInterval(id);
  }, []);

  const shown = Math.min(step, MAX_STEP);

  return (
    <figure aria-label="Animation comparing an append-only context window with Rote's evicted context window over a nine-step run">
      <div className="flex gap-3 sm:gap-5">
        <Column title="append & hope" step={shown} keepsAll accent={false} />
        <Column title="rote · tier 0" step={shown} keepsAll={false} accent />
      </div>
      <figcaption className="mt-3 flex items-baseline justify-between gap-4">
        <span className="font-display italic text-ink-2 text-sm">
          &ldquo;Keep what you did, not what you saw.&rdquo;
        </span>
        <span className="font-mono text-[0.65rem] text-muted tabular-nums">
          step {shown}/{MAX_STEP}
        </span>
      </figcaption>
    </figure>
  );
}
