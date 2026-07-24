import { DocsSidebar } from "@/components/DocsSidebar";

export default function DocsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="mx-auto max-w-6xl px-5 sm:px-8 pt-12 sm:pt-16 grid gap-10 lg:grid-cols-[13rem_1fr] items-start">
      <DocsSidebar />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
