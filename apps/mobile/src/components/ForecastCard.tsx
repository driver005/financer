import { MaterialCommunityIcons } from "@expo/vector-icons";
import { Text as RNText, View } from "react-native";

import type { Forecast } from "@/api/client";
import { Card } from "@/components/ui";
import { formatCents } from "@/format";
import { forecastView } from "@/forecast";
import { periodLabel } from "@/period";
import { usePalette } from "@/theme";

/**
 * Where the current budget period is heading: the projected leftover, when the grocery budget
 * runs out and a plain-language warning. Renders nothing when the server cannot answer (an
 * older server), the rest of Today already says what is wrong then.
 */
export function ForecastCard({ data }: { data: Forecast | null }) {
  const p = usePalette();
  if (!data) return null;

  const view = forecastView(data);
  const toneColor = { good: p.good, warn: p.orange, bad: p.bad, muted: p.muted }[view.tone];
  const icon = { good: "check-circle-outline", warn: "alert-outline", bad: "alert-octagon-outline", muted: "help-circle-outline" }[view.tone] as
    | "check-circle-outline"
    | "alert-outline"
    | "alert-octagon-outline"
    | "help-circle-outline";
  const period = periodLabel({ start: data.period_start, end: data.period_end });

  return (
    <Card>
      <RNText style={{ color: p.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>END OF PERIOD FORECAST</RNText>
      {view.amountCents !== null ? (
        <>
          <RNText
            accessibilityLabel={`Projected leftover at the end of the period: ${formatCents(view.amountCents)}`}
            style={{ color: view.amountCents < 0 ? p.bad : p.text, fontSize: 34, fontWeight: "900", marginTop: 4 }}
          >
            {formatCents(view.amountCents)}
          </RNText>
          <RNText style={{ color: p.muted, fontSize: 13 }}>
            {view.amountLabel} ({period})
          </RNText>
        </>
      ) : null}
      <View
        accessibilityLabel={`Forecast: ${view.status}`}
        style={{
          flexDirection: "row",
          alignItems: "center",
          alignSelf: "flex-start",
          gap: 4,
          borderRadius: 12,
          borderWidth: 2,
          borderColor: toneColor,
          paddingHorizontal: 8,
          paddingVertical: 2,
          marginTop: view.amountCents !== null ? 8 : 6,
        }}
      >
        <MaterialCommunityIcons name={icon} size={14} color={toneColor} />
        <RNText style={{ color: toneColor, fontSize: 12, fontWeight: "800" }}>{view.status}</RNText>
      </View>
      {/* the grocery sentence is the reason itself when groceries caused the warning */}
      <RNText style={{ color: p.text, fontSize: 14, marginTop: 8 }}>{view.reason}</RNText>
      {view.groceries && view.groceries !== view.reason ? (
        <RNText style={{ color: p.muted, fontSize: 13, marginTop: 6 }}>🛒 {view.groceries}</RNText>
      ) : null}
      {view.early ? <RNText style={{ color: p.muted, fontSize: 12, marginTop: 6 }}>{view.early}</RNText> : null}
      {view.amountCents !== null ? (
        <RNText style={{ color: p.muted, fontSize: 12, marginTop: 8 }}>
          Income {formatCents(data.income_received_cents + data.income_upcoming_cents)} − spent so far {formatCents(data.spent_so_far_cents)} − fixed costs still due{" "}
          {formatCents(data.fixed_costs_due_cents)} − {formatCents(data.projected_extra_spend_cents)} more at your current pace. A budget estimate, not your bank balance.
        </RNText>
      ) : null}
    </Card>
  );
}
