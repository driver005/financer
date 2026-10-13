/**
 * Small charts on plain react-native-svg: a `Sparkline`, a vertical `BarChart` and a grouped
 * `CompareBars`. Each takes a `summary` sentence (see src/charts.ts) that is both the screen
 * reader label and, when `showSummary` is set, visible text, so the picture is never the only
 * place the information lives.
 */
import { useState } from "react";
import { Text as RNText, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Line, Path, Rect } from "react-native-svg";

import { areaPath, barRects, linePath, sparkPoints, type CategoryCompare } from "@/charts";
import { Money } from "@/components/Money";
import { categoryLabel } from "@/categoryIcons";
import { radius, space, typography, usePalette } from "@/theme";

function useWidth() {
  const [w, setW] = useState(0);
  return { w, onLayout: (e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width)) };
}

export function Sparkline({ values, height = 56, color, summary, showSummary }: { values: number[]; height?: number; color?: string; summary: string; showSummary?: boolean }) {
  const p = usePalette();
  const { w, onLayout } = useWidth();
  const stroke = color ?? p.accent;
  const pts = sparkPoints(values, w, height, 4);
  const last = pts[pts.length - 1];
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <View onLayout={onLayout} style={{ height }}>
        {w > 0 && pts.length > 0 ? (
          <Svg width={w} height={height}>
            <Line x1={0} y1={height - 4} x2={w} y2={height - 4} stroke={p.border} strokeWidth={2} />
            <Path d={areaPath(pts, height, 4)} fill={stroke} opacity={0.14} />
            <Path d={linePath(pts)} stroke={stroke} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" fill="none" />
            {last ? <Circle cx={last.x} cy={last.y} r={4.5} fill={stroke} stroke={p.surface} strokeWidth={2} /> : null}
          </Svg>
        ) : null}
      </View>
      {showSummary ? <RNText style={[typography.caption, { color: p.muted, marginTop: space.sm }]}>{summary}</RNText> : null}
    </View>
  );
}

export function BarChart({
  values,
  height = 72,
  highlight,
  summary,
  showSummary,
  gap = 4,
}: {
  values: number[];
  height?: number;
  /** Index of the bar drawn in the strong colour (default: the highest). */
  highlight?: number | null;
  summary: string;
  showSummary?: boolean;
  gap?: number;
}) {
  const p = usePalette();
  const { w, onLayout } = useWidth();
  const bars = barRects(values, w, height, gap);
  const peak = highlight === undefined ? (Math.max(...values, 0) > 0 ? values.indexOf(Math.max(...values)) : -1) : (highlight ?? -1);
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <View onLayout={onLayout} style={{ height }}>
        {w > 0 ? (
          <Svg width={w} height={height}>
            {bars.map((b, i) => (
              <Rect key={i} x={b.x} y={b.height === 0 ? height - 2 : b.y} width={b.width} height={b.height === 0 ? 2 : b.height} rx={Math.min(4, b.width / 2)} fill={i === peak ? p.accent : p.fill} opacity={b.height === 0 ? 0.25 : i === peak ? 1 : 0.55} />
            ))}
          </Svg>
        ) : null}
      </View>
      {showSummary ? <RNText style={[typography.caption, { color: p.muted, marginTop: space.sm }]}>{summary}</RNText> : null}
    </View>
  );
}

/** Per category, this period against the last one on a shared scale. */
export function CompareBars({ rows, summary, currentLabel = "This period", previousLabel = "Last period" }: { rows: CategoryCompare[]; summary: string; currentLabel?: string; previousLabel?: string }) {
  const p = usePalette();
  const max = Math.max(1, ...rows.flatMap((r) => [r.current, r.previous]));
  const track = (cents: number, color: string) => (
    <View style={{ height: 8, borderRadius: radius.pill, backgroundColor: p.accentSoft, overflow: "hidden" }}>
      <View style={{ width: `${(cents / max) * 100}%`, minWidth: cents > 0 ? 4 : 0, height: "100%", borderRadius: radius.pill, backgroundColor: color }} />
    </View>
  );
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} style={{ gap: space.lg }}>
      {rows.map((r) => (
        <View key={r.category} style={{ gap: space.xs }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.sm }}>
            <RNText numberOfLines={1} style={[typography.label, { color: p.text, flex: 1 }]}>
              {categoryLabel(r.category)}
            </RNText>
            <Money cents={r.current} variant="label" tone="plain" />
          </View>
          {track(r.current, p.accent)}
          {track(r.previous, p.muted)}
        </View>
      ))}
      <View style={{ flexDirection: "row", gap: space.lg, flexWrap: "wrap" }}>
        <Legend color={p.accent} label={currentLabel} />
        <Legend color={p.muted} label={previousLabel} />
      </View>
    </View>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      <RNText style={[typography.caption, { color: p.muted }]}>{label}</RNText>
    </View>
  );
}
