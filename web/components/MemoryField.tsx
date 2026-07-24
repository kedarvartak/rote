"use client";

import { useEffect, useRef } from "react";

/**
 * The signature: a generative field of memory cells behind the whole site.
 * A faint grid sits near-invisible; two slow-orbiting "lights" — one ink, one
 * copper — illuminate the cells they pass over (the working set) while the rest
 * stay dim (evicted). It is the product metaphor as ambient motion: what's in
 * context glows, what's out recedes. Continuous, low-contrast, non-interactive.
 *
 * Pure canvas + rAF. DPR-aware, pauses when the tab is hidden, and renders a
 * single static frame under prefers-reduced-motion.
 */
export function MemoryField() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const context = el.getContext("2d", { alpha: true });
    if (!context) return;
    // non-null locals so narrowing survives into the nested closures below
    const canvas: HTMLCanvasElement = el;
    const ctx: CanvasRenderingContext2D = context;

    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const GAP = 30;

    let w = 0;
    let h = 0;
    let cols = 0;
    let rows = 0;
    let jitter: number[] = []; // per-cell fixed base offset, deterministic

    function build() {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = Math.floor(w * dpr);
      canvas.height = Math.floor(h * dpr);
      canvas.style.width = w + "px";
      canvas.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cols = Math.ceil(w / GAP) + 1;
      rows = Math.ceil(h / GAP) + 1;
      jitter = new Array(cols * rows);
      for (let i = 0; i < jitter.length; i++) {
        // cheap deterministic hash → 0..1
        const s = Math.sin(i * 12.9898) * 43758.5453;
        jitter[i] = s - Math.floor(s);
      }
    }

    // one light source orbiting on a Lissajous path
    function light(t: number, phase: number, sx: number, sy: number) {
      return {
        x: (Math.sin(t * sx + phase) * 0.5 + 0.5) * w,
        y: (Math.cos(t * sy + phase * 1.7) * 0.5 + 0.5) * h,
      };
    }

    function render(t: number) {
      ctx.clearRect(0, 0, w, h);
      const R = Math.max(w, h) * 0.34; // light reach
      const R2 = R * R;

      const inkL = light(t, 0, 0.32, 0.24);
      const copL = light(t, 2.4, 0.21, 0.29);

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const x = c * GAP;
          const y = r * GAP;
          const j = jitter[r * cols + c];

          const dxi = x - inkL.x;
          const dyi = y - inkL.y;
          const di = dxi * dxi + dyi * dyi;
          const dxc = x - copL.x;
          const dyc = y - copL.y;
          const dc = dxc * dxc + dyc * dyc;

          const inkGlow = di < R2 ? 1 - di / R2 : 0;
          const copGlow = dc < R2 ? 1 - dc / R2 : 0;

          // most cells stay near-invisible; they emerge only under the lights,
          // so the page reads as clean black with a living warm/cool region
          const baseA = 0.006 + j * 0.008;
          const g = Math.max(inkGlow, copGlow * 1.05);
          const a = baseA + g * g * g * 0.62;

          if (a < 0.03) continue;

          // copper wins only where it clearly dominates → rare warm cells
          const copper = copGlow > inkGlow * 1.25 && copGlow > 0.12;
          const size = 1 + g * 1.6 + j * 0.4;

          if (copper) {
            ctx.fillStyle = `rgba(200,129,58,${Math.min(0.6, a).toFixed(3)})`;
          } else {
            ctx.fillStyle = `rgba(243,242,239,${Math.min(0.5, a).toFixed(3)})`;
          }
          ctx.beginPath();
          ctx.arc(x, y, size, 0, 6.2832);
          ctx.fill();
        }
      }
    }

    build();

    let raf = 0;
    let t = 0;
    let running = true;

    const loop = () => {
      if (!running) return;
      t += 0.0016;
      render(t);
      raf = requestAnimationFrame(loop);
    };

    if (reduce) {
      render(1.2); // a pleasing static frame
    } else {
      raf = requestAnimationFrame(loop);
    }

    const onResize = () => {
      build();
      if (reduce) render(1.2);
    };
    const onVisibility = () => {
      running = document.visibilityState === "visible" && !reduce;
      if (running) raf = requestAnimationFrame(loop);
      else cancelAnimationFrame(raf);
    };

    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="fixed inset-0 -z-10 h-full w-full pointer-events-none"
    />
  );
}
