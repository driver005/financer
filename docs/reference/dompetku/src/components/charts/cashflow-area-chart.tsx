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

/** Income vs expense area chart (dashboard "Arus kas 6 bulan"). */
export default function CashflowAreaChart({
  data,
  incomeLabel,
  expenseLabel,
}: {
  data: any[];
  incomeLabel: string;
  expenseLabel: string;
}) {
  usePrivacy();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="gi" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--income)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--income)" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="ge" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--expense)" stopOpacity={0.35} />
            <stop offset="100%" stopColor="var(--expense)" stopOpacity={0} />
          </linearGradient>
        </defs>
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
        <Area
          type="monotone"
          dataKey="income"
          name={incomeLabel}
          stroke="var(--income)"
          fill="url(#gi)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="expense"
          name={expenseLabel}
          stroke="var(--expense)"
          fill="url(#ge)"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
