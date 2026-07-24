/**
 * Site-wide ambient layer: token cells drifting up and out of view — the
 * eviction policy as atmosphere — plus two slow-breathing glows in the two
 * series colors. Pure CSS animation; values are index-derived so server and
 * client render identically. Hidden from assistive tech.
 */
const CELLS = Array.from({ length: 26 }, (_, i) => {
  const r = (salt: number) => (((i + 3) * 97 + salt * 53) % 100) / 100;
  const kind = i % 9 === 0 ? "copper" : i % 5 === 0 ? "blue" : "ink";
  return {
    left: `${(r(1) * 96 + 2).toFixed(1)}%`,
    top: `${(r(2) * 90 + 8).toFixed(1)}%`,
    size: 3 + Math.round(r(3) * 6),
    delay: `${(-r(4) * 30).toFixed(1)}s`,
    duration: `${(16 + r(5) * 22).toFixed(1)}s`,
    opacity: (0.12 + r(6) * 0.25).toFixed(2),
    color:
      kind === "copper"
        ? "rgba(194,117,31,0.8)"
        : kind === "blue"
          ? "rgba(75,140,200,0.65)"
          : "rgba(232,226,214,0.5)",
  };
});

export function Ambient() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden">
      <div
        className="ambient-glow"
        style={{
          width: "44rem",
          height: "44rem",
          left: "-14rem",
          top: "-16rem",
          background: "rgba(194,117,31,0.07)",
        }}
      />
      <div
        className="ambient-glow"
        style={{
          width: "40rem",
          height: "40rem",
          right: "-16rem",
          bottom: "-14rem",
          background: "rgba(75,140,200,0.055)",
          animationDelay: "-7s",
        }}
      />
      {CELLS.map((c, i) => (
        <div
          key={i}
          className="ambient-cell"
          style={{
            left: c.left,
            top: c.top,
            width: c.size,
            height: c.size,
            background: c.color,
            animationDelay: c.delay,
            animationDuration: c.duration,
            ["--cell-o" as string]: c.opacity,
          }}
        />
      ))}
    </div>
  );
}
