import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compact, money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";

/* eslint-disable @typescript-eslint/no-explicit-any */
const tooltip = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
};

/** Net worth over time (dashboard). */
export default function NetWorthChart({ data, label }: { data: any[]; label: string }) {
  usePrivacy();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gnw" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.4} />
            <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          domain={["auto", "auto"]}
          tickFormatter={(v) => compact(v)}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          width={48}
        />
        <Tooltip formatter={(v: number) => money(v)} contentStyle={tooltip} />
        <Area
          type="monotone"
          dataKey="netWorth"
          name={label}
          stroke="var(--chart-1)"
          fill="url(#gnw)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
