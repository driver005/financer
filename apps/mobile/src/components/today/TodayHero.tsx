import { useState } from "react";
import { Box, Button, CurveChart, HeroCaption, HeroCard, HeroChip, Icon, Row, Text } from "@financer/ui";

import type { Forecast, SafeToSpend } from "@/api/client";
import { useCountUp } from "@/components/motion";
import { ExplainSheet } from "@/components/today/ExplainSheet";
import { formatMoney, spokenMoney, splitMoney } from "@/format";
import { MONTH_NAMES } from "@/period";
import { paceInfo } from "@/safeToSpend";
import { curveGeometry, curveSummary, periodCurve } from "@/todayCharts";

/** `2026-10-12` -> `12 Oct`. */
function shortDay(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTH_NAMES[m - 1].slice(0, 3)}`;
}

/**
 * The top of the Today screen, and its one filled card: what you can spend per day for the rest
 * of the budget period, over a curve of what has been spent since the period began, continued as a
 * dashed line to where it is heading.
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
  const [open, setOpen] = useState(false);
  const shown = useCountUp(safe?.daily_cents ?? 0);

  if (!safe) {
    return (
      <HeroCard label="Safe to spend today">
        <Text variant="body" tone="on-accent-solid">Not available right now. Check the connection to your server and pull the screen again.</Text>
      </HeroCard>
    );
  }

  const pace = paceInfo(safe);
  const over = safe.income_detected && safe.available_cents < 0;
  const parts = splitMoney(shown);
  const period = { start: safe.period_start, end: safe.period_end };
  const stillToCome = forecast ? forecast.fixed_costs_due_cents + forecast.projected_extra_spend_cents : null;
  const curve = periodCurve(txs, period, today, stillToCome);

  return (
    <>
      <HeroCard label="Safe to spend today" chip={<HeroChip icon={over ? "alert-outline" : pace.tone === "good" ? "check-circle-outline" : "speedometer"} text={pace.title} />}>
        <Row gap="2xs" align="baseline" accessible accessibilityLabel={`Safe to spend today: ${spokenMoney(safe.daily_cents)} per day`}>
          <Box shrink><Text variant="display" tone="on-accent-solid" fit>{`${parts.sign}${parts.whole}`}</Text></Box>
          <Text variant="subheading" tone="on-accent-solid">{`,${parts.fraction} €`}</Text>
        </Row>
        <HeroCaption>{`a day for the next ${safe.days_left} ${safe.days_left === 1 ? "day" : "days"}`}</HeroCaption>

        <Box pt="md">
          <CurveChart summary={curveSummary(curve)} build={(w, h, pad) => curveGeometry(curve, w, h, pad)} />
        </Box>
        <Row justify="between">
          <HeroCaption>{shortDay(period.start)}</HeroCaption>
          <HeroCaption>{shortDay(period.end)}</HeroCaption>
        </Row>

        <Row gap="lg" wrap>
          <Row gap="xs"><Icon name="minus" size="sm" tone="on-accent-solid" /><HeroCaption>{`Spent so far ${formatMoney(curve.spent)}`}</HeroCaption></Row>
          {curve.projectedEnd !== null ? <Row gap="xs"><Icon name="dots-horizontal" size="sm" tone="on-accent-solid" /><HeroCaption>{`Expected by the end ${formatMoney(curve.projectedEnd)}`}</HeroCaption></Row> : null}
        </Row>

        <Row><Button label="How is this calculated?" icon="help-circle-outline" variant="soft" size="sm" onPress={() => setOpen(true)} /></Row>
      </HeroCard>
      <ExplainSheet data={safe} visible={open} onClose={() => setOpen(false)} />
    </>
  );
}
