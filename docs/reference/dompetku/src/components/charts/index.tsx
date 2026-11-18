import { lazy, Suspense, type ComponentProps, type ComponentType } from "react";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Recharts is ~400 kB; every chart is a React.lazy component so it lands in its own
 * chunk and never in a route/entry chunk. The parent keeps sizing the wrapper
 * (e.g. `h-64`), so the skeleton fallback fills exactly the space the chart will use
 * — no layout shift. React.lazy is SSR-safe: the server streams the resolved chart
 * (or the fallback) and the client hydrates once the chunk is loaded.
 */
export function ChartSkeleton() {
  return <Skeleton className="size-full rounded-xl" aria-hidden />;
}

function withSuspense<P extends object>(Comp: ComponentType<P>) {
  return function LazyChart(props: P) {
    return (
      <Suspense fallback={<ChartSkeleton />}>
        <Comp {...props} />
      </Suspense>
    );
  };
}

const LazyDonut = lazy(() => import("./donut-chart"));
const LazyCashflowArea = lazy(() => import("./cashflow-area-chart"));
const LazyStackedArea = lazy(() => import("./stacked-area-chart"));
const LazyNetWorth = lazy(() => import("./net-worth-chart"));
const LazyCategoryLines = lazy(() => import("./category-line-chart"));
const LazyCashflowBars = lazy(() => import("./cashflow-bar-chart"));
const LazyBalanceLine = lazy(() => import("./balance-line-chart"));

export const DonutChart = withSuspense<ComponentProps<typeof LazyDonut>>(LazyDonut);
export const CashflowAreaChart =
  withSuspense<ComponentProps<typeof LazyCashflowArea>>(LazyCashflowArea);
export const StackedAreaChart =
  withSuspense<ComponentProps<typeof LazyStackedArea>>(LazyStackedArea);
export const NetWorthChart = withSuspense<ComponentProps<typeof LazyNetWorth>>(LazyNetWorth);
export const CategoryLineChart =
  withSuspense<ComponentProps<typeof LazyCategoryLines>>(LazyCategoryLines);
export const CashflowBarChart =
  withSuspense<ComponentProps<typeof LazyCashflowBars>>(LazyCashflowBars);
export const BalanceLineChart =
  withSuspense<ComponentProps<typeof LazyBalanceLine>>(LazyBalanceLine);

export type { DonutSlice } from "./donut-chart";
export type { LineSeries } from "./category-line-chart";
