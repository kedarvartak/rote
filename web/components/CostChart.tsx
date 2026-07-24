"use client";

import { useState } from "react";

/**
 * T11 — mean billed cost per task before/after routing the immutable prefix
 * through prompt_cache_key, with Browser Use as the reference.
 * Data: docs/testing/data/T11-cache-key-economics-summary.json.
 */
const ROWS = [
  { cell: "WP-N09", before: 0.01927, after: 0.01684, bu: 0.01464, note: "shortest cell — Rote still loses on cost" },
  { cell: "WP-N13", before: 0.01932, after: 0.01213, bu: 0.0185, note: "34.4% cheaper than Browser Use" },
  { cell: "WP-N17", before: 0.02351, after: 0.02006, bu: 0.02199, note: "8.8% cheaper than Browser Use" },
  { cell: "WP-N21", before: 0.02704, after: 0.02362, bu: 0.02575, note: "8.3% cheaper than Browser Use" },
  { cell: "WP-N25", before: 0.03098, after: 0.02461, bu: 0.02929, note: "20.5% cost cut · 16.0% cheaper than Browser Use" },
];

const W = 960;
const ROW_H = 62;
const M = { top: 10, right: 32, bottom: 38, left: 88 };
const H = M.top + ROWS.length * ROW_H + M.bottom;
const X_MIN = 0.01;
const X_MAX = 0.033;

const x = (v: number) =>
  M.left + ((v - X_MIN) / (X_MAX - X_MIN)) * (W - M.left - M.right);

export function CostChart() {
  const [hover, setHover] = useState<number | null>(null);

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3 text-[0.75rem] text-ink-2">
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-3 rounded-full border-2 border-copper inline-block" /> Rote, before cache key
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-3 h-3 rounded-full bg-copper inline-block" /> Rote, after
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-1 h-3.5 bg-blue inline-block rounded-[1px]" /> Browser Use
        </span>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-label="Dumbbell chart: mean billed cost per task by cell, Rote before and after prompt cache key routing, with Browser Use reference marks."
      >
        {[0.01, 0.015, 0.02, 0.025, 0.03].map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={M.top} y2={H - M.bottom} stroke="#242a31" strokeWidth={1} />
            <text
              x={x(t)}
              y={H - M.bottom + 18}
              textAnchor="middle"
              fontSize={11}
              fill="#7e7d75"
              fontFamily="var(--font-mono)"
            >
              ${t.toFixed(3)}
            </text>
          </g>
        ))}
        {ROWS.map((r, i) => {
          const cy = M.top + i * ROW_H + ROW_H / 2;
          const active = hover === i;
          return (
            <g
              key={r.cell}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            >
              {/* generous hit target */}
              <rect x={0} y={cy - ROW_H / 2} width={W} height={ROW_H} fill={active ? "rgba(232,226,214,0.04)" : "transparent"} />
              <text x={M.left - 10} y={cy + 4} textAnchor="end" fontSize={11.5} fill="#c3c2b7" fontFamily="var(--font-mono)">
                {r.cell}
              </text>
              {/* before → after */}
              <line x1={x(r.before)} x2={x(r.after)} y1={cy} y2={cy} stroke="#c2751f" strokeWidth={2} opacity={0.55} />
              <circle cx={x(r.before)} cy={cy} r={6} fill="#151a20" stroke="#c2751f" strokeWidth={2} />
              <circle cx={x(r.after)} cy={cy} r={6.5} fill="#c2751f" stroke="#151a20" strokeWidth={2} />
              {/* Browser Use reference tick */}
              <rect x={x(r.bu) - 1.5} y={cy - 9} width={3} height={18} rx={1} fill="#4b8cc8" />
              {/* direct label on the after mark */}
              <text
                x={x(r.after)}
                y={cy - 14}
                textAnchor="middle"
                fontSize={10.5}
                fill={active ? "#e8e2d6" : "#898781"}
                fontFamily="var(--font-mono)"
              >
                ${r.after.toFixed(4)}
              </text>
            </g>
          );
        })}
      </svg>
      {hover !== null && (
        <div className="pointer-events-none absolute z-10 right-2 top-2 rounded-sm border hairline bg-surface-2 px-3 py-2 shadow-lg text-[0.72rem] leading-relaxed max-w-[19rem]">
          <p className="font-mono text-muted">{ROWS[hover].cell}</p>
          <p className="tabular-nums">
            <span className="text-copper-bright">Rote</span> ${ROWS[hover].before.toFixed(4)} → $
            {ROWS[hover].after.toFixed(4)}
          </p>
          <p className="tabular-nums">
            <span className="text-blue-bright">Browser Use</span> ${ROWS[hover].bu.toFixed(4)}
          </p>
          <p className="text-ink-2">{ROWS[hover].note}</p>
        </div>
      )}
    </div>
  );
}
