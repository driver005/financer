import { type ReactNode, useEffect, useRef, useState } from "react";
import { Animated, type LayoutChangeEvent, View } from "react-native";
import Svg, { Circle, Rect } from "react-native-svg";

import type { Tone } from "../constants/colors";
import { duration, opacity } from "../constants/misc";
import { radius } from "../constants/radius";
import { size } from "../constants/sizes";
import { space } from "../constants/spacing";
import { Box, Row } from "../primitives/Box";
import { Text } from "../primitives/Text";
import { useTheme } from "../theme/ThemeProvider";
import { barRects, clamp01, dashOffset, ringGeometry } from "./geometry";

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
      <View style={{ width: size.icon.xs, height: size.icon.xs, borderRadius: radius.full, backgroundColor: color }} />
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

