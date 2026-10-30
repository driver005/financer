import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, Text as RNText, View } from "react-native";

import type { SafeToSpend } from "@/api/client";
import { Sparkline } from "@/components/Charts";
import { StatusPill } from "@/components/rows";
import { Bar } from "@/components/ui";
import { formatMoney, spokenMoney } from "@/format";
import { periodLabel, previousPeriod } from "@/period";
import { periodCurve, spendComparison } from "@/todayCharts";
import { radius, space, tabular, typography, usePalette, type Palette } from "@/theme";

type Tx = { booking_date: string; amount_cents: number; category?: string | null };
type Route = "/spending" | "/budget" | "/subscriptions";

/**
 * "This period" in four tinted tiles: what was spent (with its curve and the change against the
 * same days of the last period), what came in, what is still to pay and what is left. This is the
 * one place the app uses filled tiles; everything else is flat sections. Each tile opens the screen
 * behind it and says so in its label for screen readers.
 */
export function OverviewTiles({ safe, txs, today }: { safe: SafeToSpend | null; txs: Tx[]; today: string }) {
  const p = usePalette();
  if (!safe) return null;

  const period = { start: safe.period_start, end: safe.period_end };
  const curve = periodCurve(txs, period, today, null);
  const cmp = spendComparison(txs, period, previousPeriod(period, safe.payday), today);
  const incomeShare = safe.income_cents > 0 ? Math.min(1, safe.income_received_cents / safe.income_cents) : 0;
  const leftShare = safe.income_cents > 0 ? Math.max(0, Math.min(1, safe.available_cents / safe.income_cents)) : 0;

  return (
    <View style={{ marginBottom: space.lg }}>
      <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: space.md, marginBottom: space.sm }}>
        <RNText accessibilityRole="header" style={[typography.bodyStrong, { color: p.text }]}>This period</RNText>
        <RNText style={[typography.caption, { color: p.muted }]}>{periodLabel(period)}</RNText>
      </View>
      <View style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", gap: space.md }}>
          <Tile
            label="Spent"
            cents={curve.spent}
            tint={p.accentSoft}
            to="/spending"
            spoken={`Spent ${spokenMoney(curve.spent)} so far${cmp.deltaPercent === null ? "" : `, ${Math.abs(cmp.deltaPercent)} percent ${cmp.deltaPercent > 0 ? "more" : "less"} than the same days last period`}`}
            chip={
              cmp.deltaPercent !== null && cmp.deltaPercent !== 0 ? (
                <StatusPill tone={cmp.deltaPercent > 0 ? "warn" : "good"} icon={cmp.deltaPercent > 0 ? "arrow-up" : "arrow-down"} label={`${Math.abs(cmp.deltaPercent)} %`} />
              ) : null
            }
          >
            <Sparkline values={curve.cumulative} height={36} summary="Spending so far this period" />
          </Tile>
          <Tile label="Income" cents={safe.income_received_cents} tint={p.goodSoft} to="/spending" spoken={`Income received ${spokenMoney(safe.income_received_cents)} of ${spokenMoney(safe.income_cents)} expected`}>
            <Bar progress={incomeShare} color={p.good} height={8} marginTop={0} accessibilityLabel={`${Math.round(incomeShare * 100)} percent of the expected income received`} />
            <Caption>of {formatMoney(safe.income_cents)} expected</Caption>
          </Tile>
        </View>
        <View style={{ flexDirection: "row", gap: space.md }}>
          <Tile label="Still to pay" cents={safe.fixed_costs_due_cents} tint={p.warnSoft} to="/subscriptions" spoken={`Still to pay ${spokenMoney(safe.fixed_costs_due_cents)} in fixed costs`}>
            <Caption>fixed costs due before the period ends</Caption>
          </Tile>
          <Tile label="Left to spend" cents={safe.available_cents} tint={p.blueSoft} to="/budget" bad={safe.income_detected && safe.available_cents < 0} spoken={`Left to spend ${spokenMoney(safe.available_cents)}`}>
            <Bar progress={leftShare} color={p.blue} height={8} marginTop={0} accessibilityLabel={`${Math.round(leftShare * 100)} percent of the income is still free`} />
            <Caption>{safe.income_cents > 0 ? `${Math.round(leftShare * 100)} % of income` : "free this period"}</Caption>
          </Tile>
        </View>
      </View>
    </View>
  );
}

function Caption({ children }: { children: ReactNode }) {
  const p = usePalette();
  return <RNText style={[typography.caption, { color: p.muted, marginTop: space.xs }]}>{children}</RNText>;
}

function Tile({
  label,
  cents,
  tint,
  to,
  spoken,
  chip,
  bad,
  children,
}: {
  label: string;
  cents: number;
  tint: Palette["accentSoft"];
  to: Route;
  spoken: string;
  chip?: ReactNode;
  bad?: boolean;
  children?: ReactNode;
}) {
  const p = usePalette();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.push(to)}
      accessibilityRole="button"
      accessibilityLabel={`${spoken}. Opens the details.`}
      style={({ pressed }) => ({ flex: 1, minWidth: 0, backgroundColor: tint, borderRadius: radius.xl, padding: space.md, opacity: pressed ? 0.85 : 1 })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm }}>
        <RNText style={[typography.label, { color: p.muted, flexShrink: 1 }]} numberOfLines={1}>
          {label}
        </RNText>
        <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: p.accent, alignItems: "center", justifyContent: "center" }}>
          <MaterialCommunityIcons name="arrow-top-right" size={14} color={p.onAccent} />
        </View>
      </View>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, marginTop: space.xs, flexWrap: "wrap" }}>
        <RNText style={[typography.heading, tabular, { color: bad ? p.bad : p.text, flexShrink: 1 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
          {formatMoney(cents)}
        </RNText>
        {chip}
      </View>
      <View style={{ marginTop: space.sm, minHeight: 36, justifyContent: "flex-end" }}>{children}</View>
    </Pressable>
  );
}
