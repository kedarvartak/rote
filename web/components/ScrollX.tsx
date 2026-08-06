"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A horizontal scroll container that tells the reader it scrolls.
 *
 * Wide content — the charts — cannot reflow onto a phone, so it has to scroll.
 * Silent clipping is the failure mode: the SVG ends at the card edge and reads
 * as a broken chart rather than a scrollable one. This wrapper adds the two
 * things a bare `overflow-x-auto` is missing: edge gradients that appear only
 * on the side with content left to reach, and a one-shot hint that retires
 * itself once the reader scrolls.
 *
 * The container is focusable with a label: a scrollable region that only
 * responds to pointers is unreachable by keyboard (WCAG 2.1.1).
 *
 * @param label - names the region for screen readers and the keyboard focus ring
 * @param hint - short affordance text; pass null to suppress it
 * @param fade - Tailwind `from-*` colour for the edge gradients; must match
 *   whatever the container sits on, or the fade shows as a coloured smear
 */
export function ScrollX({
  label,
  hint = "Scroll chart",
  fade = "from-surface",
  className = "",
  children,
}: {
  label: string;
  hint?: string | null;
  fade?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const [nudged, setNudged] = useState(false);

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    // 2px slack: sub-pixel layout rounding otherwise leaves a phantom edge
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft < max - 2 });
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    measure();
    el.addEventListener("scroll", measure, { passive: true });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // the SVG child can change width independently of the container
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => {
      el.removeEventListener("scroll", measure);
      ro.disconnect();
    };
  }, [measure]);

  const scrollable = edges.left || edges.right;

  return (
    <div className={`relative ${className}`}>
      <div
        ref={ref}
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={() => setNudged(true)}
        className="overflow-x-auto overscroll-x-contain rounded-sm focus-visible:outline-2 focus-visible:outline-copper-bright focus-visible:outline-offset-2"
      >
        {children}
      </div>

      {/* edge gradients — only on the side that still has content */}
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r ${fade} to-transparent transition-opacity duration-200 ${
          edges.left ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l ${fade} to-transparent transition-opacity duration-200 ${
          edges.right ? "opacity-100" : "opacity-0"
        }`}
      />

      {/* the hint rides the right edge, next to the fade it explains — above
          the container it would collide with whatever legend or heading the
          caller has put there */}
      {hint && (
        <p
          aria-hidden
          className={`pointer-events-none absolute bottom-2 right-2 rounded-full border hairline bg-surface-2/90 backdrop-blur-sm px-2.5 py-1 font-mono text-[0.6rem] tracking-widest uppercase text-ink-2 transition-opacity duration-300 ${
            scrollable && !nudged ? "opacity-100" : "opacity-0"
          }`}
        >
          {hint} →
        </p>
      )}
    </div>
  );
}
