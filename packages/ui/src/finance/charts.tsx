import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, type LayoutChangeEvent, View } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Rect, Stop } from "react-native-svg";

import type { Tone } from "../constants/colors";
import { duration, opacity } from "../constants/misc";
import { radius } from "../constants/radius";
import { size } from "../constants/sizes";
import { space } from "../constants/spacing";
import { Box, Row } from "../primitives/Box";
import { Dot } from "../primitives/Dot";
import { Text } from "../primitives/Text";
import { useTheme } from "../theme/ThemeProvider";
import { type Point, areaPath, barRects, clamp01, dashOffset, donutArcs, linePath, ringGeometry } from "./geometry";

function useWidth() {
  const [w, setW] = useState(0);
  return { w, onLayout: (e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width)) };
}

/**
 * Vertical bars, the highest one strong and the rest faint. `summary` is the sentence that goes with
 * the picture: it is the screen reader label and, with `showSummary`, visible text, so the picture
 * is never the only place the information lives. `onCard` draws it in a hero card's ink.
 */
export function BarChart({
  values, height = "md", highlight, summary, showSummary, onCard,
}: {
  values: number[];
  height?: keyof typeof size.chart;
  /** Index of the strong bar (default: the highest); `null` for none. */
  highlight?: number | null;
  summary: string;
  showSummary?: boolean;
  onCard?: boolean;
}) {
  const { colors } = useTheme();
  const { w, onLayout } = useWidth();
  const h = size.chart[height];
  const bars = barRects(values, w, h, space.xs, size.stroke.lg);
  const peak = highlight === undefined ? (Math.max(...values, 0) > 0 ? values.indexOf(Math.max(...values)) : -1) : (highlight ?? -1);
  const ink = onCard ? colors.tones.accent.onSolid : colors.tones.accent.solid;
  return (
    <Box gap="sm" accessible accessibilityRole="image" accessibilityLabel={summary}>
      <View onLayout={onLayout} style={{ height: h }}>
        {w > 0 ? (
          <Svg width={w} height={h}>
            {bars.map((b, i) => (
              <Rect
                key={i}
                x={b.x}
                y={b.height === 0 ? h - size.stroke.lg : b.y}
                width={b.width}
                height={b.height === 0 ? size.stroke.lg : b.height}
                rx={Math.min(size.stroke.xl, b.width / 2)}
                fill={ink}
                opacity={b.height === 0 ? opacity[25] : i === peak ? opacity[100] : opacity[50]}
              />
            ))}
          </Svg>
        ) : null}
      </View>
      {showSummary ? <Text variant="caption" tone={onCard ? "on-accent-solid" : "muted"}>{summary}</Text> : null}
    </Box>
  );
}

export type CompareBarRow = { key: string; label: string; current: number; previous: number; value: ReactNode };

/** Per row, this period against the last one on a shared scale. */
export function CompareBars({ rows, summary, currentLabel = "This period", previousLabel = "Last period" }: { rows: CompareBarRow[]; summary: string; currentLabel?: string; previousLabel?: string }) {
  const { colors } = useTheme();
  const max = Math.max(1, ...rows.flatMap((r) => [r.current, r.previous]));
  const track = (v: number, color: string) => (
    <View style={{ height: size.bar.md, borderRadius: radius.full, backgroundColor: colors.sunken, overflow: "hidden" }}>
      <View style={{ width: `${(v / max) * 100}%`, minWidth: v > 0 ? size.bar.md : 0, height: size.bar.md, borderRadius: radius.full, backgroundColor: color }} />
    </View>
  );
  return (
    <Box gap="lg" accessible accessibilityRole="image" accessibilityLabel={summary}>
      {rows.map((r) => (
        <Box key={r.key} gap="xs">
          <Row justify="between" gap="sm" align="baseline">
            <Box grow><Text variant="label" numberOfLines={1}>{r.label}</Text></Box>
            {r.value}
          </Row>
          {track(r.current, colors.tones.accent.solid)}
          {track(r.previous, colors.text.subtle)}
        </Box>
      ))}
      <Row gap="lg" wrap>
        <Legend color={colors.tones.accent.solid} label={currentLabel} />
        <Legend color={colors.text.subtle} label={previousLabel} />
      </Row>
    </Box>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Row gap="xs">
      <Dot color={color} />
      <Text variant="caption" tone="muted">{label}</Text>
    </Row>
  );
}

const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/**
 * A progress ring. `progress` is 0..1 and the arc starts at 12 o'clock and runs clockwise. The
 * children sit in the middle (the hero number). The ring is decorative: give it a `label` that says
 * the same in words and keep the real figures as text next to or inside it.
 */
export function ProgressRing({
  progress, box = "xl", stroke = "xl", tone = "accent", label, children,
}: {
  progress: number;
  box?: keyof typeof size.ring;
  stroke?: keyof typeof size.stroke;
  tone?: Tone;
  label?: string;
  children?: ReactNode;
}) {
  const { colors } = useTheme();
  const d = size.ring[box];
  const sw = size.stroke[stroke];
  const { c, r, circumference } = ringGeometry(d, sw);
  const target = clamp01(progress);
  const drawn = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(drawn, { toValue: target, duration: duration.slower, useNativeDriver: false }).start();
  }, [target, drawn]);
  const offset = drawn.interpolate({ inputRange: [0, 1], outputRange: [dashOffset(circumference, 0), dashOffset(circumference, 1)] });
  return (
    <View
      style={{ width: d, height: d, alignItems: "center", justifyContent: "center" }}
      accessible={Boolean(label)}
      accessibilityRole={label ? "progressbar" : undefined}
      accessibilityLabel={label}
      accessibilityValue={label ? { min: 0, max: 100, now: Math.round(target * 100) } : undefined}
    >
      <Svg width={d} height={d} style={{ position: "absolute" }} pointerEvents="none">
        <Circle cx={c} cy={c} r={r} stroke={colors.tones[tone].soft} strokeWidth={sw} fill="none" />
        <AnimatedCircle
          cx={c}
          cy={c}
          r={r}
          stroke={colors.tones[tone].solid}
          strokeWidth={sw}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${circumference} ${circumference}`}
          strokeDashoffset={offset as unknown as number}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </Svg>
      {children}
    </View>
  );
}


// ---- the curve under a hero card, the week's columns and the donut of categories ----


export type CurveGeometry = { solid: Point[]; dashed: Point[]; today: Point };

/**
 * A line that grows through the period with a soft fill under it, and a dashed continuation to where
 * it is heading. `build` turns the measured width and height into points (the screen owns the data);
 * the chart draws them in the hero card's ink.
 */
export function CurveChart({ summary, build }: { summary: string; build: (width: number, height: number, pad: number) => CurveGeometry }) {
  const { colors } = useTheme();
  const { w, onLayout } = useWidth();
  const h = size.chart.lg + size.chart.md / 2;
  const pad = space.sm;
  const ink = colors.tones.accent.onSolid;
  const geo = w > 0 ? build(w, h, pad) : null;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary} onLayout={onLayout} style={{ height: h }}>
      {geo ? (
        <Svg width={w} height={h}>
          <Defs>
            <LinearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor={ink} stopOpacity={opacity[40]} />
              <Stop offset="1" stopColor={ink} stopOpacity={0} />
            </LinearGradient>
          </Defs>
          <Line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke={ink} strokeOpacity={opacity[25]} strokeWidth={size.stroke.md} />
          {geo.solid.length > 1 ? <Path d={areaPath(geo.solid, h, pad)} fill="url(#heroFill)" /> : null}
          {geo.solid.length > 1 ? <Path d={linePath(geo.solid)} stroke={ink} strokeWidth={size.stroke.lg} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
          {geo.dashed.length > 1 ? <Path d={linePath(geo.dashed)} stroke={ink} strokeOpacity={opacity[75]} strokeWidth={size.stroke.lg} strokeDasharray={`${size.stroke.md} ${space.sm}`} strokeLinecap="round" fill="none" /> : null}
          {geo.dashed.length > 1 ? <Circle cx={geo.dashed[1].x} cy={geo.dashed[1].y} r={size.stroke.xl} fill="none" stroke={ink} strokeOpacity={opacity[75]} strokeWidth={size.stroke.md} /> : null}
          <Circle cx={geo.today.x} cy={geo.today.y} r={space.sm + size.stroke.md} fill={ink} fillOpacity={opacity[25]} />
          <Circle cx={geo.today.x} cy={geo.today.y} r={size.stroke.xl} fill={ink} />
        </Svg>
      ) : null}
    </View>
  );
}

export type Column = { key: string; value: number; label: string; strong?: boolean; note?: string };

/**
 * Columns with a letter under each (the last seven days): the strong one in the accent, the rest
 * faint, an optional dotted line for the average. Drawn with plain views, so the columns line up
 * with their letters at any text size.
 */
export function ColumnChart({ columns, average, summary }: { columns: Column[]; average?: number; summary: string }) {
  const { colors } = useTheme();
  const plot = size.chart.lg + size.chart.md / 2;
  const room = plot - size.icon.xl;
  const max = Math.max(...columns.map((c) => c.value), 0);
  const peak = max > 0 ? columns.findIndex((c) => c.value === max) : -1;
  const avgY = max > 0 && average ? Math.round((average / max) * room) : 0;
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={summary}>
      <View style={{ height: plot, flexDirection: "row", gap: space.sm }}>
        {avgY > 0 ? <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: avgY, borderTopWidth: size.stroke.md / 2, borderTopColor: colors.text.muted, borderStyle: "dotted", opacity: opacity[75] }} /> : null}
        {columns.map((c, i) => {
          const hh = c.value > 0 ? Math.max(size.bar.lg, Math.round((c.value / max) * room)) : 0;
          return (
            <View key={c.key} style={{ flex: 1, justifyContent: "flex-end", alignItems: "center" }}>
              {i === peak && c.note ? <Text variant="caption" numberOfLines={1}>{c.note}</Text> : null}
              <View
                style={{
                  width: "72%",
                  maxWidth: size.icon.xl,
                  height: hh || size.stroke.lg,
                  borderTopLeftRadius: radius.md,
                  borderTopRightRadius: radius.md,
                  borderBottomLeftRadius: radius.sm,
                  borderBottomRightRadius: radius.sm,
                  backgroundColor: hh === 0 ? colors.border.default : c.strong ? colors.tones.accent.solid : colors.tones.accent.solid,
                  opacity: hh === 0 ? opacity[100] : c.strong ? opacity[100] : opacity[40],
                }}
              />
            </View>
          );
        })}
      </View>
      <Row gap="sm">
        {columns.map((c) => (
          <Box key={c.key} equal align="center">
            <Text variant="caption" tone={c.strong ? "accent" : "muted"} align="center">{c.label}</Text>
          </Box>
        ))}
      </Row>
    </View>
  );
}

const SERIES: Tone[] = ["accent", "info", "success", "warning", "danger"];

/** The colour of the i-th slice of a chart; the folded "other" slice is grey. */
export function useSeriesColor(): (index: number, other?: boolean) => string {
  const { colors } = useTheme();
  return (index, other) => (other ? colors.text.muted : colors.tones[SERIES[index % SERIES.length]].solid);
}

/**
 * A donut: shares that add up to 1, a label in the middle. The colours only tell the slices apart, so
 * every slice also has a legend row that names it (use `useSeriesColor` for the legend dots).
 */
export function DonutChart({ slices, centre, caption, summary }: { slices: { key: string; share: number; other?: boolean }[]; centre: string; caption: string; summary: string }) {
  const { colors } = useTheme();
  const colour = useSeriesColor();
  const d = size.ring.xl - size.icon.xl;
  const sw = size.stroke.xl * 4 + size.stroke.lg;
  const r = (d - sw) / 2;
  const arcs = donutArcs(slices.map((s) => s.share), r, size.stroke.xl);
  return (
    <View style={{ width: d, height: d, alignItems: "center", justifyContent: "center" }} accessible accessibilityRole="image" accessibilityLabel={summary}>
      <Svg width={d} height={d} style={{ position: "absolute" }}>
        <Circle cx={d / 2} cy={d / 2} r={r} stroke={colors.sunken} strokeWidth={sw} fill="none" />
        {slices.map((s, i) => (
          <Circle
            key={s.key}
            cx={d / 2}
            cy={d / 2}
            r={r}
            stroke={colour(i, s.other)}
            strokeWidth={sw}
            strokeLinecap="butt"
            fill="none"
            strokeDasharray={arcs[i].dash}
            strokeDashoffset={arcs[i].offset}
            transform={`rotate(-90 ${d / 2} ${d / 2})`}
          />
        ))}
      </Svg>
      <Text variant="caption" tone="muted">{caption}</Text>
      <Text variant="bodyStrong" fit>{centre}</Text>
    </View>
  );
}
