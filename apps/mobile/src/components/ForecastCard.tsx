import { useState } from "react";
import { Text as RNText, View } from "react-native";

import type { Forecast } from "@/api/client";
import { ChunkyButton } from "@/components/kit";
import { IconBadge, StatusPill, type Tone } from "@/components/rows";
import { Money } from "@/components/Money";
import { Card } from "@/components/ui";
import { formatMoney, spokenMoney } from "@/format";
import { forecastView } from "@/forecast";
import { periodLabel } from "@/period";
import { space, typography, usePalette } from "@/theme";

const ICON = { good: "check-circle-outline", warn: "alert-outline", bad: "alert-octagon-outline", muted: "help-circle-outline" } as const;
const TONE: Record<"good" | "warn" | "bad" | "muted", Tone> = { good: "good", warn: "warn", bad: "bad", muted: "muted" };

/**
 * Where the current budget period is heading: the projected leftover, when the grocery budget
 * runs out and a plain-language warning. A secondary card on Today (the daily number is the hero).
 * Renders nothing when the server cannot answer (an older server), the rest of Today already says
 * what is wrong then.
 */
export function ForecastCard({ data }: { data: Forecast | null }) {
  const p = usePalette();
  const [open, setOpen] = useState(false);
  if (!data) return null;

  const view = forecastView(data);
  const tone = TONE[view.tone];
  const period = periodLabel({ start: data.period_start, end: data.period_end });

  return (
    <Card>
      <RNText style={[typography.overline, { color: p.muted }]}>End of period forecast</RNText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.sm }}>
        <IconBadge icon={ICON[view.tone]} tone={tone} />
        <View style={{ flex: 1, minWidth: 0 }}>
          {view.amountCents !== null ? (
            <Money
              cents={view.amountCents}
              variant="heading"
              tone={view.amountCents < 0 ? "bad" : "plain"}
              label={`Projected leftover at the end of the period: ${spokenMoney(view.amountCents)}`}
              style={{ fontSize: 26, lineHeight: 32 }}
            />
          ) : (
            <RNText style={[typography.bodyStrong, { color: p.text }]}>{view.status}</RNText>
          )}
        </View>
        {view.amountCents !== null ? <StatusPill label={view.status} tone={tone} accessibilityLabel={`Forecast: ${view.status}`} /> : null}
      </View>
      {view.amountCents !== null ? (
        <RNText style={[typography.caption, { color: p.muted, marginTop: space.sm }]}>
          {view.amountLabel} ({period})
        </RNText>
      ) : null}
      {/* the grocery sentence is the reason itself when groceries caused the warning */}
      <RNText style={[typography.body, { color: p.text, marginTop: space.md }]}>{view.reason}</RNText>
      {view.groceries && view.groceries !== view.reason ? (
        <RNText style={[typography.caption, { color: p.muted, marginTop: space.sm }]}>{view.groceries}</RNText>
      ) : null}
      {view.early || view.amountCents !== null ? (
        <View style={{ alignSelf: "flex-start", marginTop: space.xs, marginLeft: -space.sm }}>
          <ChunkyButton compact flat icon={open ? "chevron-up" : "chevron-down"} label={open ? "Hide details" : "Details"} onPress={() => setOpen((v) => !v)} />
        </View>
      ) : null}
      {open ? (
        <View>
      {view.early ? <RNText style={[typography.caption, { color: p.muted, marginTop: space.sm }]}>{view.early}</RNText> : null}
        {view.amountCents !== null ? (
          <RNText style={[typography.caption, { color: p.muted, marginTop: space.md, fontSize: 12 }]}>
            Income {formatMoney(data.income_received_cents + data.income_upcoming_cents)} − spent so far {formatMoney(data.spent_so_far_cents)} − fixed costs still due{" "}
            {formatMoney(data.fixed_costs_due_cents)} − {formatMoney(data.projected_extra_spend_cents)} more at your current pace. A budget estimate, not your bank balance.
          </RNText>
        ) : null}
        </View>
      ) : null}
    </Card>
  );
}
