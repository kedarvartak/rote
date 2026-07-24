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
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <div className="sticky top-3 sm:top-4 z-50 px-4 sm:px-8">
      <header
        className={`mx-auto max-w-3xl rounded-full border backdrop-blur-xl h-12 sm:h-13 px-4 sm:px-7 flex items-center justify-between transition-all duration-500 ${
          scrolled
            ? "bg-bg/80 hairline shadow-lg shadow-black/30"
            : "bg-bg/40 border-transparent"
        }`}
      >
        <Link href="/" className="font-display text-xl sm:text-2xl tracking-tight leading-none">
          rote
        </Link>
        <nav className="flex items-center gap-0 sm:gap-2">
          {links.map((l) => {
            const active =
              l.href === "/docs"
                ? pathname === "/docs"
                : pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`px-1.5 sm:px-3 py-1.5 text-[0.72rem] sm:text-[0.82rem] rounded-full transition-colors ${
                  active
                    ? "text-copper-bright"
                    : "text-ink-2 hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
      </header>
    </div>
  );
}
