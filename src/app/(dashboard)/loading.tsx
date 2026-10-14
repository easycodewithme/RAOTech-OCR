import { TableSkeleton, PageHeaderSkeleton } from "@/components/Skeleton";

/**
 * Shown the instant a sidebar link is clicked, while the server renders the
 * page. Without a loading.tsx the App Router has no static shell to prefetch,
 * so every navigation blocked on the server with no visual feedback at all.
 */
export default function DashboardLoading() {
  return (
    <div className="p-4 md:p-6 lg:p-7 space-y-6">
      <PageHeaderSkeleton />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-[1px]" style={{ background: "var(--spx-border)" }}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-[100px]" style={{ background: "var(--spx-card)" }} />
        ))}
      </div>

      <div className="overflow-hidden" style={{ border: "1px solid var(--spx-border)", background: "var(--spx-card)" }}>
        <TableSkeleton rows={6} />
      </div>
    </div>
  );
}
