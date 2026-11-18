import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Route-level loading placeholders. Used as `pendingComponent` on _app routes so a slow
 * loader shows the page's shape instead of a blank area. They mirror the loaded layouts
 * (same grids/heights) to avoid layout shift. Pair with `pendingMs: PENDING_MS`.
 */
export const PENDING_MS = 300;

function HeaderSkeleton({ actions = 1 }: { actions?: number }) {
  return (
    <div
      className="mb-6 grid grid-cols-[minmax(0,1fr)_auto] items-end gap-4 max-sm:grid-cols-1"
      aria-busy="true"
    >
      <div className="min-w-0 space-y-2">
        <Skeleton className="h-9 w-48 max-w-full sm:h-10" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {actions ? (
        <div className="flex flex-wrap gap-2">
          {Array.from({ length: actions }, (_, i) => (
            <Skeleton key={i} className="h-9 w-28" />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function StatCardsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 4 }, (_, i) => (
        <Card key={i} className="min-w-0 space-y-3 p-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-7 w-36 max-w-full" />
          <Skeleton className="h-3 w-20" />
        </Card>
      ))}
    </div>
  );
}

function ChartCardSkeleton({ className = "", height = "h-64" }) {
  return (
    <Card className={`min-w-0 p-5 ${className}`}>
      <Skeleton className="mb-4 h-6 w-48 max-w-full" />
      <Skeleton className={`${height} w-full rounded-xl`} />
    </Card>
  );
}

function ListCardSkeleton({ rows = 4, className = "" }: { rows?: number; className?: string }) {
  return (
    <Card className={`min-w-0 space-y-3 p-5 ${className}`}>
      <Skeleton className="mb-1 h-6 w-32" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </Card>
  );
}

function MonthSwitcherSkeleton() {
  return <Skeleton className="mb-5 h-9 w-56 max-w-full" />;
}

export function DashboardSkeleton() {
  return (
    <>
      <HeaderSkeleton actions={3} />
      <MonthSwitcherSkeleton />
      <StatCardsSkeleton />
      <ChartCardSkeleton className="mt-4" height="h-16" />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ChartCardSkeleton className="lg:col-span-2" height="h-64 short:h-48" />
        <ChartCardSkeleton height="h-64 short:h-48" />
      </div>
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <ListCardSkeleton />
        <ListCardSkeleton />
        <ListCardSkeleton />
      </div>
    </>
  );
}

export function ReportsSkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <ChartCardSkeleton height="h-64 sm:h-80 short:h-56" />
      <ListCardSkeleton rows={6} className="mt-4" />
    </>
  );
}

export function RekapSkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <MonthSwitcherSkeleton />
      <StatCardsSkeleton />
      <ChartCardSkeleton className="mt-4" height="h-72 short:h-52" />
      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCardSkeleton height="h-64 short:h-52" />
        <ListCardSkeleton rows={6} />
      </div>
    </>
  );
}

/** Generic list/CRUD page: header + a card of rows. */
export function PageSkeleton() {
  return (
    <>
      <HeaderSkeleton />
      <Card className="min-w-0 divide-y p-0">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="h-5 w-24 shrink-0" />
          </div>
        ))}
      </Card>
    </>
  );
}
