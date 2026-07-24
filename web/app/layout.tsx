import type { Metadata } from "next";
import { Newsreader, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "rote",
  description:
    "Every agent harness has memory. None of them manages it. Rote treats the context window as a managed resource — budget, eviction, layout, and a trust gate on the way back in.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${newsreader.variable} ${plexSans.variable} ${plexMono.variable}`}
    >
      <body className="relative min-h-screen flex flex-col">
        {/* corner actions: GitHub rides along (fixed), Talk to me stays on the page */}
        <a
          href="https://github.com/kedarvartak/rote"
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Star the Rote repository on GitHub"
          title="Star on GitHub"
          className="fixed top-3.5 sm:top-4 right-3 sm:right-5 z-[60] flex items-center justify-center w-10 h-10 rounded-full border hairline bg-bg/70 backdrop-blur-xl text-ink-2 hover:text-ink hover:border-copper/60 transition-colors"
        >
          <svg viewBox="0 0 16 16" className="w-[18px] h-[18px]" fill="currentColor" aria-hidden>
            <path d="M8 0c4.42 0 8 3.58 8 8a8.01 8.01 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.99 7.99 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
          </svg>
        </a>
        <a
          href="https://cal.com/kedar-vartak"
          target="_blank"
          rel="noopener noreferrer"
          className="fixed hidden xl:inline-flex items-center top-4 right-[4.5rem] z-[60] h-10 rounded-full bg-copper text-bg text-[0.82rem] font-medium px-4 hover:bg-copper-bright transition-colors"
        >
          Talk to me
        </a>
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
