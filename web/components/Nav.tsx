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
          <a
            href="https://github.com/kedarvartak/rote"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Star the Rote repository on GitHub"
            title="Star on GitHub"
            className="ml-1 sm:ml-2 text-ink-2 hover:text-ink transition-colors"
          >
            <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="currentColor" aria-hidden>
              <path d="M8 0c4.42 0 8 3.58 8 8a8.01 8.01 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.99 7.99 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
            </svg>
          </a>
          <a
            href="https://cal.com/kedar-vartak"
            target="_blank"
            rel="noopener noreferrer"
            className="hidden sm:inline-flex ml-1 rounded-full bg-copper text-bg text-[0.78rem] font-medium px-3.5 py-1.5 hover:bg-copper-bright transition-colors"
          >
            Talk to me
          </a>
        </nav>
      </header>
    </div>
  );
}
