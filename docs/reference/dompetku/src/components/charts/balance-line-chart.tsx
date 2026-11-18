import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { compact, money } from "@/lib/format";
import { usePrivacy } from "@/lib/privacy";
import { tooltipStyle } from "./shared";

/** Month-end balance of one account (account detail page). */
export default function BalanceLineChart({
  data,
  label,
  currency = "IDR",
}: {
  data: { label: string; balance: number }[];
  label: string;
  currency?: string;
}) {
  usePrivacy();
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data}>
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
        <Tooltip formatter={(v: number) => money(v, currency)} contentStyle={tooltipStyle} />
        <Line
          type="monotone"
          dataKey="balance"
          name={label}
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
