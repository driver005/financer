import { Text as RNText, View } from "react-native";

import { Money } from "@/components/Money";
import { StatusPill } from "@/components/rows";
import { Card } from "@/components/ui";
import { formatMoney } from "@/format";
import { lastWeek, weekSummary } from "@/todayCharts";
import { radius, space, tabular, typography, usePalette } from "@/theme";

const PLOT = 96;

/**
 * The last seven days as bars, today in the strong colour, with the daily average as a dotted
 * line and the change against the week before next to the total. Drawn with plain views, so the
 * columns line up with their weekday letters at any text size.
 */
export function WeekCard({ txs, today }: { txs: { booking_date: string; amount_cents: number; category?: string | null }[]; today: string }) {
  const p = usePalette();
  const week = lastWeek(txs, today);
  const max = Math.max(...week.bars.map((b) => b.cents), 0);
  const peak = max > 0 ? week.bars.findIndex((b) => b.cents === max) : -1;
  const avgY = max > 0 ? Math.round((week.average / max) * (PLOT - 20)) : 0;

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.md }}>
        <View style={{ flexShrink: 1 }}>
          <RNText style={[typography.overline, { color: p.muted }]}>Last 7 days</RNText>
          <Money cents={week.total} variant="heading" tone="plain" style={{ fontSize: 26, lineHeight: 32 }} />
        </View>
        {week.deltaPercent !== null && week.deltaPercent !== 0 ? (
          <StatusPill
            tone={week.deltaPercent > 0 ? "warn" : "good"}
            icon={week.deltaPercent > 0 ? "arrow-up" : "arrow-down"}
            label={`${Math.abs(week.deltaPercent)} %`}
            accessibilityLabel={`${Math.abs(week.deltaPercent)} percent ${week.deltaPercent > 0 ? "more" : "less"} than the 7 days before`}
          />
        ) : null}
      </View>

      <View accessible accessibilityRole="image" accessibilityLabel={weekSummary(week)} style={{ marginTop: space.md }}>
        <View style={{ height: PLOT, flexDirection: "row", gap: space.sm }}>
          {max > 0 && week.average > 0 ? (
            <View pointerEvents="none" style={{ position: "absolute", left: 0, right: 0, bottom: avgY, borderTopWidth: 1, borderTopColor: p.muted, borderStyle: "dotted", opacity: 0.7 }} />
          ) : null}
          {week.bars.map((b, i) => {
            const h = b.cents > 0 ? Math.max(6, Math.round((b.cents / max) * (PLOT - 20))) : 0;
            return (
              <View key={b.iso} style={{ flex: 1, justifyContent: "flex-end", alignItems: "center" }}>
                {i === peak ? (
                  <RNText style={[typography.caption, tabular, { color: p.text, fontWeight: "700", marginBottom: 2 }]} numberOfLines={1}>
                    {Math.round(b.cents / 100)} €
                  </RNText>
                ) : null}
                <View
                  style={{
                    width: "72%",
                    maxWidth: 32,
                    height: h || 3,
                    borderTopLeftRadius: radius.md,
                    borderTopRightRadius: radius.md,
                    borderBottomLeftRadius: radius.sm / 2,
                    borderBottomRightRadius: radius.sm / 2,
                    backgroundColor: h === 0 ? p.border : b.today ? p.accent : p.fill,
                    opacity: h === 0 ? 1 : b.today ? 1 : 0.4,
                  }}
                />
              </View>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", gap: space.sm, marginTop: space.xs }}>
          {week.bars.map((b) => (
            <RNText key={b.iso} style={[typography.caption, { flex: 1, textAlign: "center", color: b.today ? p.accent : p.muted, fontWeight: b.today ? "800" : "500" }]}>
              {b.letter}
            </RNText>
          ))}
        </View>
      </View>

      <RNText style={[typography.caption, { color: p.muted, marginTop: space.sm }]}>
        {week.total > 0 ? `Average ${formatMoney(week.average)} a day` : "Nothing spent in the last 7 days"}
      </RNText>
    </Card>
  );
}
