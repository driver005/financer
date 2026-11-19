/** Historical price comparison chart for a single item. */
import React from "react";
import { View } from "react-native";
import Svg, { Circle, Line, Polyline, Text as SvgText } from "react-native-svg";
import { Card, Text } from "./primitives";
import { palette, typography } from "./tokens";

export type ChartSeries = { storeName: string; color: string; points: { date: string; cents: number }[] };

const W = 320;
const H = 150;
const PAD = { left: 8, right: 8, top: 12, bottom: 22 };

export function PriceHistoryChart({ series, title = "Price history" }: { series: ChartSeries[]; title?: string }) {
  const all = series.flatMap((s) => s.points.map((p) => p.cents));
  if (!all.length) {
    return (
      <Card>
        <Text variant="heading5">{title}</Text>
        <Text variant="body3" color="muted">No price history yet. Add a price to start the chart.</Text>
      </Card>
    );
  }
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = Math.max(1, max - min);
  const count = Math.max(...series.map((s) => s.points.length));
  const x = (i: number) => PAD.left + (count > 1 ? (i / (count - 1)) * (W - PAD.left - PAD.right) : (W - PAD.left - PAD.right) / 2);
  const y = (cents: number) => PAD.top + (1 - (cents - min) / span) * (H - PAD.top - PAD.bottom);

  const firstDate = series[0]?.points[0]?.date ?? "";
  const lastDate = series[0]?.points[series[0].points.length - 1]?.date ?? "";

  return (
    <Card>
      <Text variant="heading5">{title}</Text>
      <Svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
        {[0, 0.5, 1].map((f) => (
          <Line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + f * (H - PAD.top - PAD.bottom)}
            y2={PAD.top + f * (H - PAD.top - PAD.bottom)} stroke="#E5E5E5" strokeWidth={1} />
        ))}
        {series.map((s) => (
          <Polyline key={s.storeName} points={s.points.map((p, i) => `${x(i)},${y(p.cents)}`).join(" ")}
            fill="none" stroke={s.color} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {series.map((s) => {
          const last = s.points[s.points.length - 1];
          return last ? <Circle key={`dot-${s.storeName}`} cx={x(s.points.length - 1)} cy={y(last.cents)} r={4} fill={s.color} /> : null;
        })}
        <SvgText x={PAD.left} y={H - 4} fontSize={10} fill={palette.inkMuted}>{firstDate.slice(5)}</SvgText>
        <SvgText x={W - PAD.right} y={H - 4} fontSize={10} fill={palette.inkMuted} textAnchor="end">{lastDate.slice(5)}</SvgText>
        <SvgText x={PAD.left} y={PAD.top - 2} fontSize={10} fill={palette.inkMuted}>{`${(max / 100).toFixed(2)} €`}</SvgText>
      </Svg>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
        {series.map((s) => (
          <View key={`legend-${s.storeName}`} style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
            <View style={{ width: 9, height: 9, borderRadius: 5, backgroundColor: s.color }} />
            <Text variant="caption" color="muted">{s.storeName}</Text>
          </View>
        ))}
      </View>
      <Text variant="body5" color="muted" style={{ fontFamily: typography.font.body, marginTop: 4 }}>
        {`Lowest ${(min / 100).toFixed(2)} € · highest ${(max / 100).toFixed(2)} € · ${all.length} saved prices`}
      </Text>
    </Card>
  );
}
