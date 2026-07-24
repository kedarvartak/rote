"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const links = [
  { href: "/architecture", label: "Architecture" },
  { href: "/docs", label: "Docs" },
  { href: "/docs/benchmarks", label: "Benchmarks" },
  { href: "/docs/roadmap", label: "Roadmap" },
];

export function Nav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`sticky top-0 z-50 transition-all duration-500 ${
        scrolled ? "bg-bg/70 backdrop-blur-xl" : "bg-transparent"
      }`}
    >
      <div className="mx-auto max-w-7xl px-6 sm:px-10 h-20 flex items-center justify-between">
        <Link href="/" className="flex items-center gap-2.5 group">
          <span
            className="w-2 h-2 rounded-full bg-copper pulse"
            aria-hidden
          />
          <span className="display text-xl text-ink">rote</span>
        </Link>
        <nav className="flex items-center gap-6 sm:gap-9">
          {links.map((l) => {
            const active =
              l.href === "/docs"
                ? pathname === "/docs"
                : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`text-[0.85rem] transition-colors duration-300 ${
                  active ? "text-ink" : "text-ink-2 hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
