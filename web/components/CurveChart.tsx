"use client";

import { useEffect, useRef, useState } from "react";

/**
 * G1 — cumulative logical input vs task length.
 * Data: docs/testing/data/T10-g1-curve-summary.json (gpt-4.1-mini,
 * 15 matched repetitions per cell, 75/75 verified successes per harness).
 */
const CELLS = [
  { steps: 9, rote: 47204, bu: 55104, red: "14.3% [14.1–14.7]" },
  { steps: 13, rote: 51068, bu: 68455, red: "25.4% [25.0–25.7]" },
  { steps: 17, rote: 60331, bu: 82152, red: "26.6% [25.7–27.5]" },
  { steps: 21, rote: 69476, bu: 95888, red: "27.5% [26.6–28.5]" },
  { steps: 25, rote: 81203, bu: 110131, red: "26.3% [25.4–27.2]" },
];

const W = 960;
const H = 420;
const M = { top: 26, right: 132, bottom: 46, left: 64 };
const X_MIN = 8;
const X_MAX = 26;
const Y_MAX = 120000;

const x = (steps: number) =>
  M.left + ((steps - X_MIN) / (X_MAX - X_MIN)) * (W - M.left - M.right);
const y = (tok: number) => M.top + (1 - tok / Y_MAX) * (H - M.top - M.bottom);

function linePath(key: "rote" | "bu") {
  return CELLS.map(
    (c, i) => `${i === 0 ? "M" : "L"}${x(c.steps).toFixed(1)},${y(c[key]).toFixed(1)}`,
  ).join(" ");
}

export function CurveChart() {
  const [hover, setHover] = useState<number | null>(null);
  const [drawn, setDrawn] = useState(false);
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setDrawn(true);
          io.disconnect();
        }
      },
      { threshold: 0.3 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * W;
    let best = 0;
    let bestD = Infinity;
    CELLS.forEach((c, i) => {
      const d = Math.abs(x(c.steps) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHover(bestD < 60 ? best : null);
  };

  const h = hover === null ? null : CELLS[hover];

  return (
    <div>
      <div className="flex items-center gap-5 mb-3 text-[0.75rem] text-ink-2">
        <span className="inline-flex items-center gap-2">
          <span className="w-4 h-0.5 rounded bg-blue inline-block" /> Browser Use 0.13.6
        </span>
        <span className="inline-flex items-center gap-2">
          <span className="w-4 h-0.5 rounded bg-copper inline-block" /> Rote
        </span>
      </div>
      <div className="overflow-x-auto">
      <div className="relative min-w-[40rem]">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto touch-none"
        role="img"
        aria-label="Line chart: cumulative logical input tokens for Rote versus Browser Use across task lengths of 9 to 25 steps. Rote grows 37.2 percent slower."
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {/* gridlines + y labels */}
        {[0, 30000, 60000, 90000, 120000].map((t) => (
          <g key={t}>
            <line
              x1={M.left}
              x2={W - M.right}
              y1={y(t)}
              y2={y(t)}
              stroke={t === 0 ? "#383835" : "#242a31"}
              strokeWidth={1}
            />
            <text
              x={M.left - 8}
              y={y(t) + 4}
              textAnchor="end"
              fontSize={11}
              fill="#7e7d75"
              fontFamily="var(--font-mono)"
            >
              {t === 0 ? "0" : `${t / 1000}K`}
            </text>
          </g>
        ))}
        {/* x labels */}
        {CELLS.map((c) => (
          <text
            key={c.steps}
            x={x(c.steps)}
            y={H - M.bottom + 20}
            textAnchor="middle"
            fontSize={11}
            fill="#7e7d75"
            fontFamily="var(--font-mono)"
          >
            {c.steps}
          </text>
        ))}
        <text
          x={(M.left + W - M.right) / 2}
          y={H - 4}
          textAnchor="middle"
          fontSize={11}
          fill="#7e7d75"
        >
          verified steps per task (WP-N09 → WP-N25)
        </text>

        {/* hover crosshair */}
        {h && (
          <line
            x1={x(h.steps)}
            x2={x(h.steps)}
            y1={M.top}
            y2={H - M.bottom}
            stroke="rgba(232,226,214,0.18)"
            strokeWidth={1}
          />
        )}

        {/* series */}
        {(["bu", "rote"] as const).map((key) => (
          <path
            key={key}
            d={linePath(key)}
            fill="none"
            stroke={key === "rote" ? "#c2751f" : "#4b8cc8"}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={drawn ? 0 : 1}
            style={{ transition: "stroke-dashoffset 1.4s cubic-bezier(0.4,0,0.2,1)" }}
          />
        ))}
        {CELLS.map((c, i) => (
          <g key={c.steps} opacity={drawn ? 1 : 0} style={{ transition: `opacity 0.4s ${0.5 + i * 0.15}s` }}>
            <circle cx={x(c.steps)} cy={y(c.bu)} r={hover === i ? 5.5 : 4} fill="#4b8cc8" stroke="#151a20" strokeWidth={2} />
            <circle cx={x(c.steps)} cy={y(c.rote)} r={hover === i ? 5.5 : 4} fill="#c2751f" stroke="#151a20" strokeWidth={2} />
          </g>
        ))}

        {/* direct labels at line ends */}
        <text x={x(25) + 12} y={y(CELLS[4].bu) + 4} fontSize={12} fill="#c3c2b7">
          Browser Use
        </text>
        <text x={x(25) + 12} y={y(CELLS[4].rote) + 4} fontSize={12} fill="#c3c2b7">
          Rote
        </text>
      </svg>

      {h && (
        <div
          className="pointer-events-none absolute z-10 rounded-sm border hairline bg-surface-2 px-3 py-2 shadow-lg text-[0.72rem] leading-relaxed"
          style={{
            left: `${(x(h.steps) / W) * 100}%`,
            top: 40,
            transform: x(h.steps) > W * 0.6 ? "translateX(-105%)" : "translateX(12px)",
          }}
        >
          <p className="font-mono text-muted">WP-N{String(h.steps).padStart(2, "0")}</p>
          <p className="tabular-nums">
            <span className="text-blue-bright">Browser Use</span>{" "}
            {h.bu.toLocaleString()} tok
          </p>
          <p className="tabular-nums">
            <span className="text-copper-bright">Rote</span>{" "}
            {h.rote.toLocaleString()} tok
          </p>
          <p className="text-ink-2">reduction {h.red}</p>
        </div>
      )}
      </div>
      </div>
    </div>
  );
}
