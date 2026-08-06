import { DocsSidebar, DocsTabs } from "@/components/DocsSidebar";

export default function DocsLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {/* outside the grid so it can stick — see DocsTabs */}
      <DocsTabs />
      <div className="mx-auto max-w-6xl px-5 sm:px-8 pt-8 lg:pt-16 grid gap-10 lg:grid-cols-[13rem_1fr] items-start">
        <DocsSidebar />
        <div className="min-w-0">{children}</div>
      </div>
    </>
  );
}
