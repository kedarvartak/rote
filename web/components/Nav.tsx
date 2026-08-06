"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const links = [
  { href: "/architecture", label: "Architecture" },
  { href: "/docs", label: "Docs" },
  { href: "/docs/benchmarks", label: "Benchmarks" },
  { href: "/docs/roadmap", label: "Roadmap" },
];

export function Nav() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // close the mobile menu on navigation
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // an open menu owns the screen: Escape closes it, the page underneath stops
  // scrolling, and focus moves into the panel so a keyboard lands in the menu
  // rather than continuing down the page behind it
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.querySelector("a")?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open]);

  const isActive = (href: string) =>
    href === "/docs" ? pathname === "/docs" : pathname.startsWith(href);

  return (
    <div className="sticky top-3 sm:top-4 z-50 pl-4 pr-16 sm:pl-8 sm:pr-16 xl:px-8 pointer-events-none">
      {/* backdrop: tapping anywhere off the menu closes it */}
      {open && (
        <div
          className="sm:hidden fixed inset-0 -z-10 bg-bg/60 backdrop-blur-sm pointer-events-auto"
          onClick={() => setOpen(false)}
          aria-hidden
        />
      )}

      <header
        className={`pointer-events-auto flex items-center h-12 sm:h-13 rounded-full border backdrop-blur-xl transition-all duration-500 w-full justify-between px-4 sm:w-fit sm:mx-auto sm:justify-start sm:gap-8 sm:px-6 ${
          scrolled || open
            ? "bg-bg/80 hairline shadow-lg shadow-black/30"
            : "bg-bg/40 border-transparent"
        }`}
      >
        <Link
          href="/"
          className="font-display text-xl sm:text-2xl tracking-tight leading-none"
        >
          rote
        </Link>

        {/* desktop links */}
        <nav className="hidden sm:flex items-center gap-2">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              aria-current={isActive(l.href) ? "page" : undefined}
              className={`px-3 py-1.5 text-[0.82rem] rounded-full transition-colors ${
                isActive(l.href) ? "text-copper-bright" : "text-ink-2 hover:text-ink"
              }`}
            >
              {l.label}
            </Link>
          ))}
        </nav>

        {/* mobile menu toggle — 44px square, the comfortable thumb minimum */}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="mobile-menu"
          aria-label={open ? "Close menu" : "Open menu"}
          className="sm:hidden flex items-center justify-center w-11 h-11 -mr-2.5 text-ink-2 hover:text-ink transition-colors"
        >
          <svg
            viewBox="0 0 20 20"
            className="w-5 h-5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            aria-hidden
          >
            {open ? (
              <>
                <path d="M5 5 L15 15" />
                <path d="M15 5 L5 15" />
              </>
            ) : (
              <>
                <path d="M3 6 H17" />
                <path d="M3 10 H17" />
                <path d="M3 14 H17" />
              </>
            )}
          </svg>
        </button>
      </header>

      {/* mobile menu panel */}
      {open && (
        <div
          id="mobile-menu"
          ref={panelRef}
          className="sm:hidden pointer-events-auto mt-2 rounded-2xl border hairline bg-bg/95 backdrop-blur-xl shadow-xl shadow-black/40 p-2"
        >
          <nav className="flex flex-col">
            {links.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                aria-current={isActive(l.href) ? "page" : undefined}
                className={`px-4 py-3.5 rounded-xl text-[0.95rem] transition-colors ${
                  isActive(l.href)
                    ? "text-copper-bright bg-copper/10"
                    : "text-ink-2 hover:text-ink hover:bg-surface"
                }`}
              >
                {l.label}
              </Link>
            ))}
            <a
              href="https://github.com/kedarvartak/rote"
              target="_blank"
              rel="noopener noreferrer"
              className="px-4 py-3.5 rounded-xl text-[0.95rem] text-ink-2 hover:text-ink hover:bg-surface transition-colors"
            >
              GitHub ↗
            </a>
            <a
              href="https://cal.com/kedar-vartak"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 mx-1 mb-1 rounded-full bg-copper text-bg text-center text-[0.92rem] font-medium px-4 py-3 hover:bg-copper-bright transition-colors"
            >
              Talk to me
            </a>
          </nav>
        </div>
      )}
    </div>
  );
}
