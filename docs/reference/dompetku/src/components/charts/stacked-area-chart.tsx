import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compact, money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { CHART_PALETTE } from "./shared";

/* eslint-disable @typescript-eslint/no-explicit-any */
const tooltip = {
  background: "var(--card)",
  border: "1px solid var(--border)",
  borderRadius: 12,
};

/** Stacked per-category expense trend (dashboard). */
export default function StackedAreaChart({ data, keys }: { data: any[]; keys: string[] }) {
  usePrivacy();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
        <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={12} />
        <YAxis
          tickFormatter={(v) => compact(v)}
          tickLine={false}
          axisLine={false}
          fontSize={12}
          width={48}
        />
        <Tooltip formatter={(v: number) => money(v)} contentStyle={tooltip} />
        <Legend />
        {keys.map((c, i) => (
          <Area
            key={c}
            type="monotone"
            dataKey={c}
            stackId="1"
            stroke={CHART_PALETTE[i % CHART_PALETTE.length]}
            fill={CHART_PALETTE[i % CHART_PALETTE.length]}
            fillOpacity={0.5}
            strokeWidth={1.5}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
