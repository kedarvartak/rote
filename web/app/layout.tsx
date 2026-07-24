import type { Metadata } from "next";
import { Space_Grotesk, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";
import { Footer } from "@/components/Footer";
import { MemoryField } from "@/components/MemoryField";

const space = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-space",
});

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-inter",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "Rote — the memory manager for browser agents",
  description:
    "Every agent harness has memory. None of them manages it. Rote treats the context window as a managed resource — budget, eviction, layout, and a trust gate on the way back in.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      className={`${space.variable} ${inter.variable} ${plexMono.variable}`}
    >
      <body className="min-h-screen flex flex-col">
        <MemoryField />
        <Nav />
        <main className="flex-1">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
