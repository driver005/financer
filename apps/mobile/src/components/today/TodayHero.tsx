import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useState } from "react";
import { Pressable, Text as RNText, View, type LayoutChangeEvent } from "react-native";
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop } from "react-native-svg";

import type { Forecast, SafeToSpend } from "@/api/client";
import { areaPath, linePath } from "@/charts";
import { useCountUp } from "@/components/motion";
import { PanelChip } from "@/components/panel";
import { ExplainSheet } from "@/components/today/ExplainSheet";
import { formatMoney, spokenMoney, splitMoney } from "@/format";
import { MONTH_NAMES } from "@/period";
import { heroFontSize } from "@/ring";
import { paceInfo } from "@/safeToSpend";
import { curveGeometry, curveSummary, periodCurve } from "@/todayCharts";
import { radius, space, tabular, typography, usePalette } from "@/theme";

const CHART_HEIGHT = 112;

/** `2026-10-12` -> `12 Oct`. */
function shortDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

/**
 * The top of the Today screen, and its one filled panel: what you can spend per day for the rest
 * of the budget period, over a curve of what has been spent since the period began, continued as a
 * dashed line to where it is heading. Below it the three numbers behind the daily amount.
 * Everything on the panel is drawn in `onAccent` (at different strengths) so it reads in both themes.
 */
export function TodayHero({
  safe,
  forecast,
  txs,
  today,
}: {
  safe: SafeToSpend | null;
  forecast: Forecast | null;
  txs: { booking_date: string; amount_cents: number; category?: string | null }[];
  today: string;
}) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  const [w, setW] = useState(0);
  const shown = useCountUp(safe?.daily_cents ?? 0);

  if (!safe) {
    return (
      <View style={{ backgroundColor: p.accent, borderRadius: radius.xl, padding: space.lg, marginBottom: space.lg }}>
        <RNText style={[typography.label, { color: p.onAccent, opacity: 0.85 }]}>Safe to spend today</RNText>
        <RNText style={[typography.body, { color: p.onAccent, marginTop: space.sm }]}>
          Not available right now. Check the connection to your server and pull the screen again.
        </RNText>
      </View>
    );
  }

  const pace = paceInfo(safe);
  const over = safe.income_detected && safe.available_cents < 0;
  const parts = splitMoney(shown);
  const heroSize = heroFontSize(`${parts.sign}${parts.whole}`, 180, 52, 30);
  const period = { start: safe.period_start, end: safe.period_end };
  const stillToCome = forecast ? forecast.fixed_costs_due_cents + forecast.projected_extra_spend_cents : null;
  const curve = periodCurve(txs, period, today, stillToCome);
  const geo = curveGeometry(curve, w, CHART_HEIGHT, 8);
  const summary = curveSummary(curve);
  const ink = p.onAccent;

  return (
    <>
      <View style={{ backgroundColor: p.accent, borderRadius: radius.xl, paddingTop: space.lg, paddingHorizontal: space.lg, paddingBottom: space.md, marginBottom: space.lg, overflow: "hidden" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
          <RNText style={[typography.label, { color: ink, opacity: 0.85 }]}>Safe to spend today</RNText>
          <PanelChip icon={over ? "alert-outline" : pace.tone === "good" ? "check-circle-outline" : "speedometer"} text={pace.title} />
        </View>

        <RNText
          numberOfLines={1}
          adjustsFontSizeToFit
          minimumFontScale={0.6}
          maxFontSizeMultiplier={1.2}
          accessibilityLabel={`Safe to spend today: ${spokenMoney(safe.daily_cents)} per day`}
          style={{ color: ink, ...tabular, fontWeight: "900", fontSize: 24, marginTop: space.xs }}
        >
          <RNText style={{ fontSize: heroSize, lineHeight: Math.round(heroSize * 1.14) }}>
            {parts.sign}
            {parts.whole}
          </RNText>
          ,{parts.fraction}&nbsp;€
        </RNText>
        <RNText style={[typography.label, { color: ink, opacity: 0.85 }]}>
          a day for the next {safe.days_left} {safe.days_left === 1 ? "day" : "days"}
        </RNText>

        <View
          accessible
          accessibilityRole="image"
          accessibilityLabel={summary}
          onLayout={(e: LayoutChangeEvent) => setW(Math.round(e.nativeEvent.layout.width))}
          style={{ height: CHART_HEIGHT, marginTop: space.lg }}
        >
          {w > 0 ? (
            <Svg width={w} height={CHART_HEIGHT}>
              <Defs>
                <LinearGradient id="heroFill" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor={ink} stopOpacity={0.38} />
                  <Stop offset="1" stopColor={ink} stopOpacity={0} />
                </LinearGradient>
              </Defs>
              <Line x1={8} y1={CHART_HEIGHT - 8} x2={w - 8} y2={CHART_HEIGHT - 8} stroke={ink} strokeOpacity={0.3} strokeWidth={1} />
              {geo.solid.length > 1 ? <Path d={areaPath(geo.solid, CHART_HEIGHT, 8)} fill="url(#heroFill)" /> : null}
              {geo.solid.length > 1 ? <Path d={linePath(geo.solid)} stroke={ink} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" fill="none" /> : null}
              {geo.dashed.length > 1 ? <Path d={linePath(geo.dashed)} stroke={ink} strokeOpacity={0.75} strokeWidth={2} strokeDasharray="2 6" strokeLinecap="round" fill="none" /> : null}
              {geo.dashed.length > 1 ? <Circle cx={geo.dashed[1].x} cy={geo.dashed[1].y} r={4} fill="none" stroke={ink} strokeOpacity={0.85} strokeWidth={1.5} /> : null}
              <Circle cx={geo.today.x} cy={geo.today.y} r={9} fill={ink} fillOpacity={0.25} />
              <Circle cx={geo.today.x} cy={geo.today.y} r={4.5} fill={ink} />
            </Svg>
          ) : null}
        </View>
        <View style={{ flexDirection: "row", justifyContent: "space-between", marginTop: space.xs }}>
          <RNText style={[typography.caption, { color: ink, opacity: 0.8 }]}>{shortDay(period.start)}</RNText>
          <RNText style={[typography.caption, { color: ink, opacity: 0.8 }]}>{shortDay(period.end)}</RNText>
        </View>

        <View style={{ flexDirection: "row", gap: space.lg, marginTop: space.sm }}>
          <LegendItem solid label="Spent so far" value={formatMoney(curve.spent)} />
          {curve.projectedEnd !== null ? <LegendItem label="Expected by the end" value={formatMoney(curve.projectedEnd)} /> : null}
        </View>

        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="How is this calculated?"
          hitSlop={8}
          style={{ flexDirection: "row", alignItems: "center", gap: space.xs, minHeight: 44, alignSelf: "flex-start", marginTop: space.xs }}
        >
          <MaterialCommunityIcons name="help-circle-outline" size={16} color={ink} />
          <RNText style={[typography.label, { color: ink, textDecorationLine: "underline" }]}>How is this calculated?</RNText>
        </Pressable>
      </View>
      <ExplainSheet data={safe} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}

function LegendItem({ label, value, solid }: { label: string; value: string; solid?: boolean }) {
  const p = usePalette();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, flexShrink: 1 }}>
      <View
        style={{
          width: 16,
          height: 0,
          borderTopWidth: 2,
          borderTopColor: p.onAccent,
          borderStyle: solid ? "solid" : "dotted",
          opacity: solid ? 1 : 0.8,
        }}
      />
      <RNText style={[typography.caption, { color: p.onAccent, flexShrink: 1 }]}>
        {label} <RNText style={[tabular, { fontWeight: "800" }]}>{value}</RNText>
      </RNText>
    </View>
  );
}
