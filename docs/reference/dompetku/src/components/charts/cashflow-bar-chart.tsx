import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
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

/** Monthly income vs expense bars (rekap). */
export default function CashflowBarChart({
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
      <BarChart data={data}>
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
        <Bar dataKey="income" name={incomeLabel} fill="var(--income)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="expense" name={expenseLabel} fill="var(--expense)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
