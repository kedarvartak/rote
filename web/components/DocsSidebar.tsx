"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
    items: [{ href: "/docs/benchmarks", label: "Benchmarks & runs" }],
  },
  {
    label: "Code",
    items: [
      { href: "/docs/packages", label: "Packages" },
      { href: "/architecture", label: "Architecture ↗" },
    ],
  },
];

export function DocsSidebar() {
  const pathname = usePathname();
  return (
    <nav className="lg:sticky lg:top-24 flex lg:flex-col gap-6 lg:gap-8 overflow-x-auto pb-2 lg:pb-0">
      {groups.map((g) => (
        <div key={g.label} className="shrink-0">
          <p className="eyebrow mb-2.5">{g.label}</p>
          <ul className="flex lg:flex-col gap-1">
            {g.items.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  className={`block px-2.5 py-1.5 rounded-sm text-[0.85rem] whitespace-nowrap transition-colors ${
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
