"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { ScrollX } from "./ScrollX";

const groups = [
  {
    label: "Project",
    items: [
      { href: "/docs", label: "Overview" },
      { href: "/docs/roadmap", label: "Roadmap & status" },
    ],
  },
  {
    label: "Evidence",
    items: [
      { href: "/docs/benchmarks", label: "Benchmarks & runs" },
      { href: "/docs/cosmetic-drift", label: "Cosmetic drift" },
    ],
  },
  {
    label: "Code",
    items: [
      { href: "/docs/packages", label: "Packages" },
      { href: "/architecture", label: "Architecture ↗" },
    ],
  },
];

const flat = groups.flatMap((g) => g.items);

/**
 * The phone docs nav: one scrollable tab bar that stays under the nav pill.
 *
 * The desktop rail's group headings are dropped here — three labels plus
 * their rows cost more vertical space above the article than they buy in
 * wayfinding, and a single track keeps all five destinations in one gesture.
 *
 * Rendered above the docs grid, not inside the sidebar cell: `sticky` needs a
 * containing block taller than itself, and a grid cell holding only this bar
 * is exactly its own height.
 */
export function DocsTabs() {
  const pathname = usePathname();
  const barRef = useRef<HTMLDivElement>(null);

  // the bar scrolls, so the current page can start off screen — bring it into
  // view rather than making the reader hunt for where they are. scrollLeft is
  // set directly: scrollIntoView would also scroll the page, and centring the
  // chip pushes the earlier sections off the left edge for no gain.
  useEffect(() => {
    const bar = barRef.current?.parentElement; // the ScrollX viewport
    const active = barRef.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!bar || !active) return;
    const view = bar.getBoundingClientRect();
    const chip = active.getBoundingClientRect();
    if (chip.right > view.right) bar.scrollLeft += chip.right - view.right + 16;
    else if (chip.left < view.left) bar.scrollLeft -= view.left - chip.left + 16;
  }, [pathname]);

  return (
    <nav
      aria-label="Documentation"
      className="lg:hidden sticky top-[4.25rem] z-30 px-5 sm:px-8 py-2 bg-bg/90 backdrop-blur-xl border-b hairline"
    >
      <ScrollX label="Documentation sections" hint={null} fade="from-bg">
        <div ref={barRef} className="flex gap-1.5 snap-x">
          {flat.map((i) => (
            <Link
              key={i.href}
              href={i.href}
              aria-current={pathname === i.href ? "page" : undefined}
              className={`snap-start shrink-0 flex items-center px-3.5 min-h-11 rounded-full border text-[0.85rem] whitespace-nowrap transition-colors ${
                pathname === i.href
                  ? "border-copper/50 text-copper-bright bg-copper/10"
                  : "hairline text-ink-2 hover:text-ink"
              }`}
            >
              {i.label}
            </Link>
          ))}
        </div>
      </ScrollX>
    </nav>
  );
}

/** The desktop docs rail: grouped, sticky beside the article. */
export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Documentation"
      className="hidden lg:flex lg:sticky lg:top-24 lg:flex-col gap-8"
    >
      {groups.map((g) => (
        <div key={g.label}>
          <p className="eyebrow mb-2.5">{g.label}</p>
          <ul className="flex flex-col gap-1">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  aria-current={pathname === i.href ? "page" : undefined}
                  className={`block px-2.5 py-2 rounded-sm text-[0.85rem] transition-colors ${
                    pathname === i.href
                      ? "text-copper-bright bg-copper/10"
                      : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {i.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
