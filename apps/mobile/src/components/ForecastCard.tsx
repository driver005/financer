import { useState } from "react";
import { Badge, Box, Button, Card, IconBadge, Money, Row, Text } from "@financer/ui";

import type { Forecast } from "@/api/client";
import { formatMoney, spokenMoney } from "@/format";
import { forecastView } from "@/forecast";
import { periodLabel } from "@/period";
import { toTone } from "@/uiTone";

const ICON = { good: "check-circle-outline", warn: "alert-outline", bad: "alert-octagon-outline", muted: "help-circle-outline" } as const;

/**
 * Where the current budget period is heading: the projected leftover, when the grocery budget
 * runs out and a plain-language warning. A secondary card on Today (the daily number is the hero).
 * Renders nothing when the server cannot answer (an older server), the rest of Today already says
 * what is wrong then.
 */
export function ForecastCard({ data }: { data: Forecast | null }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;

  const view = forecastView(data);
  const tone = toTone(view.tone);
  const period = periodLabel({ start: data.period_start, end: data.period_end });

  return (
    <Card gap="md">
      <Text variant="label" tone="muted">End of period forecast</Text>
      <Row gap="md">
        <IconBadge icon={ICON[view.tone]} tone={tone} />
        <Box grow>
          {view.amountCents !== null ? (
            <Money cents={view.amountCents} variant="title" tone={view.amountCents < 0 ? "bad" : "plain"} label={`Projected leftover at the end of the period: ${spokenMoney(view.amountCents)}`} />
          ) : (
            <Text variant="bodyStrong">{view.status}</Text>
          )}
        </Box>
        {view.amountCents !== null ? <Badge label={view.status} tone={tone} /> : null}
      </Row>
      {view.amountCents !== null ? <Text variant="caption" tone="muted">{`${view.amountLabel} (${period})`}</Text> : null}
      {/* the grocery sentence is the reason itself when groceries caused the warning */}
      <Text variant="body">{view.reason}</Text>
      {view.groceries && view.groceries !== view.reason ? <Text variant="caption" tone="muted">{view.groceries}</Text> : null}
      {view.early || view.amountCents !== null ? (
        <Row><Button size="sm" variant="ghost" icon={open ? "chevron-up" : "chevron-down"} label={open ? "Hide details" : "Details"} onPress={() => setOpen((v) => !v)} /></Row>
      ) : null}
      {open ? (
        <Box gap="sm">
          {view.early ? <Text variant="caption" tone="muted">{view.early}</Text> : null}
          {view.amountCents !== null ? (
            <Text variant="caption" tone="muted">
              {`Income ${formatMoney(data.income_received_cents + data.income_upcoming_cents)} − spent so far ${formatMoney(data.spent_so_far_cents)} − fixed costs still due ${formatMoney(data.fixed_costs_due_cents)} − ${formatMoney(data.projected_extra_spend_cents)} more at your current pace. A budget estimate, not your bank balance.`}
            </Text>
          ) : null}
        </Box>
      ) : null}
    </Card>
  );
}
