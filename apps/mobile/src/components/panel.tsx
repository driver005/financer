import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState, type ReactNode } from "react";
import { StyleSheet, Text as RNText, View, type LayoutChangeEvent } from "react-native";
import Svg, { Rect } from "react-native-svg";

import { barRects } from "@/charts";
import { splitMoney } from "@/format";
import { heroFontSize } from "@/ring";
import { radius, space, tabular, typography, usePalette } from "@/theme";

/**
 * The filled panel at the top of a screen: one label, one big figure, an optional chip and chart.
 * Everything on it is drawn in `onAccent` at different strengths, so it reads in both themes. Use
 * it once per screen, for the number the screen is about (see docs/UI_DESIGN.md).
 */
export function HeroPanel({ label, chip, children }: { label: string; chip?: ReactNode; children?: ReactNode }) {
  const p = usePalette();
  return (
    <View style={{ backgroundColor: p.accent, borderRadius: radius.xl, padding: space.lg, marginBottom: space.lg, overflow: "hidden" }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
        <RNText style={[typography.label, { color: p.onAccent, opacity: 0.85, flexShrink: 1 }]}>{label}</RNText>
        {chip}
      </View>
      {children}
    </View>
  );
}

/** A small translucent pill on the panel; pass an icon name and a short text. */
export function PanelChip({ icon, text }: { icon?: string; text: string }) {
  const p = usePalette();
  return (
    <View style={{ borderRadius: radius.pill, overflow: "hidden", flexShrink: 1 }}>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: p.onAccent, opacity: 0.2 }]} />
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.xs, paddingHorizontal: space.md, minHeight: 28 }}>
        {icon ? <MaterialCommunityIcons name={icon as React.ComponentProps<typeof MaterialCommunityIcons>["name"]} size={14} color={p.onAccent} /> : null}
        <RNText style={[typography.caption, { color: p.onAccent, fontWeight: "700" }]} numberOfLines={1}>
          {text}
        </RNText>
      </View>
    </View>
  );
}

/** The big amount of a panel: whole part large, cents and euro sign small, shrinking to fit. */
export function PanelFigure({ cents, label, size = 44 }: { cents: number; label?: string; size?: number }) {
  const p = usePalette();
  const parts = splitMoney(cents);
  const big = heroFontSize(`${parts.sign}${parts.whole}`, 190, size, 28);
  return (
    <RNText
      numberOfLines={1}
      adjustsFontSizeToFit
      minimumFontScale={0.6}
      maxFontSizeMultiplier={1.2}
      accessibilityLabel={label}
      style={{ color: p.onAccent, ...tabular, fontWeight: "900", fontSize: 22, marginTop: space.xs }}
    >
      <RNText style={{ fontSize: big, lineHeight: Math.round(big * 1.14) }}>
        {parts.sign}
        {parts.whole}
      </RNText>
      ,{parts.fraction}&nbsp;€
    </RNText>
  );
}

/** Secondary text on the panel. */
export function PanelCaption({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <RNText style={[typography.caption, { color: p.onAccent, opacity: 0.85, marginTop: space.xs }]}>{children}</RNText>;
}

/** Vertical bars drawn in the panel's ink: the highlighted bar solid, the rest faint. */
export function PanelBars({ values, highlight, height = 72, summary }: { values: number[]; highlight?: number | null; height?: number; summary: string }) {
  const p = usePalette();
  const [w, setW] = useState(0);
  const bars = barRects(values, w, height, 4);
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={summary}
      onLayout={(e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width))}
      style={{ height, marginTop: space.lg }}
    >
      {w > 0 ? (
        <Svg width={w} height={height}>
          {bars.map((b, i) => (
            <Rect
              key={i}
              x={b.x}
              y={b.height === 0 ? height - 2 : b.y}
              width={b.width}
              height={b.height === 0 ? 2 : b.height}
              rx={Math.min(4, b.width / 2)}
              fill={p.onAccent}
              opacity={b.height === 0 ? 0.25 : i === highlight ? 1 : 0.45}
            />
          ))}
        </Svg>
      ) : null}
    </View>
  );
}

/** A row of label/value pairs at the foot of a panel, set off by a faint rule. */
export function PanelStats({ items }: { items: { label: string; value: string; spoken?: string }[] }) {
  const p = usePalette();
  return (
    <>
      <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: p.onAccent, opacity: 0.3, marginTop: space.lg }} />
      <View style={{ flexDirection: "row", gap: space.md, paddingTop: space.md }}>
        {items.map((it) => (
          <View key={it.label} style={{ flex: 1, minWidth: 0 }} accessible accessibilityLabel={`${it.label}: ${it.spoken ?? it.value}`}>
            <RNText style={[typography.caption, { color: p.onAccent, opacity: 0.8 }]} numberOfLines={1}>
              {it.label}
            </RNText>
            <RNText style={[typography.bodyStrong, tabular, { color: p.onAccent }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
              {it.value}
            </RNText>
          </View>
        ))}
      </View>
    </>
  );
}

/** A plain count on the panel (not money), with a small suffix such as `of 8`. */
export function PanelNumber({ value, suffix, label }: { value: string; suffix?: string; label?: string }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "baseline", gap: space.sm, marginTop: space.xs }} accessible accessibilityLabel={label ?? `${value} ${suffix ?? ""}`.trim()}>
      <RNText style={{ color: p.onAccent, ...tabular, fontWeight: "900", fontSize: 44, lineHeight: 50 }}>{value}</RNText>
      {suffix ? <RNText style={[typography.bodyStrong, { color: p.onAccent, opacity: 0.85 }]}>{suffix}</RNText> : null}
    </View>
  );
}

/** A thin progress track in the panel's ink. */
export function PanelProgress({ progress, label }: { progress: number; label: string }) {
  const p = usePalette();
  const pct = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0)) * 100;
  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(pct) }}
      style={{ height: 8, borderRadius: radius.pill, overflow: "hidden", marginTop: space.md }}
    >
      <View style={[StyleSheet.absoluteFill, { backgroundColor: p.onAccent, opacity: 0.25 }]} />
      <View style={{ width: `${pct}%`, height: "100%", borderRadius: radius.pill, backgroundColor: p.onAccent }} />
    </View>
  );
}
