import { useRouter } from "expo-router";
import type { ReactNode } from "react";
import { Badge, Box, Icon, Meter, Row, Sparkline, Text, Touchable, type Tone } from "@financer/ui";

import type { SafeToSpend } from "@/api/client";
import { formatMoney, spokenMoney } from "@/format";
import { periodLabel, previousPeriod } from "@/period";
import { periodCurve, spendComparison } from "@/todayCharts";

type Tx = { booking_date: string; amount_cents: number; category?: string | null };
type Route = "/spending" | "/budget" | "/subscriptions";

/**
 * "This period" in four tinted tiles: what was spent (with its curve and the change against the
 * same days of the last period), what came in, what is still to pay and what is left. This is the
 * one place the app uses filled tiles; everything else is flat sections. Each tile opens the screen
 * behind it and says so in its label for screen readers.
 */
export function OverviewTiles({ safe, txs, today }: { safe: SafeToSpend | null; txs: Tx[]; today: string }) {
  if (!safe) return null;

  const period = { start: safe.period_start, end: safe.period_end };
  const curve = periodCurve(txs, period, today, null);
  const cmp = spendComparison(txs, period, previousPeriod(period, safe.payday), today);
  const incomeShare = safe.income_cents > 0 ? Math.min(1, safe.income_received_cents / safe.income_cents) : 0;
  const leftShare = safe.income_cents > 0 ? Math.max(0, Math.min(1, safe.available_cents / safe.income_cents)) : 0;

  return (
    <Box gap="sm">
      <Row justify="between" align="baseline" gap="md">
        <Text variant="bodyStrong" level={2}>This period</Text>
        <Text variant="caption" tone="muted">{periodLabel(period)}</Text>
      </Row>
      <Box gap="md">
        <Row gap="md" align="stretch">
          <Tile
            label="Spent"
            cents={curve.spent}
            tone="accent"
            to="/spending"
            spoken={`Spent ${spokenMoney(curve.spent)} so far${cmp.deltaPercent === null ? "" : `, ${Math.abs(cmp.deltaPercent)} percent ${cmp.deltaPercent > 0 ? "more" : "less"} than the same days last period`}`}
            chip={cmp.deltaPercent !== null && cmp.deltaPercent !== 0 ? <Badge tone={cmp.deltaPercent > 0 ? "warning" : "success"} icon={cmp.deltaPercent > 0 ? "arrow-up" : "arrow-down"} label={`${Math.abs(cmp.deltaPercent)} %`} /> : null}
          >
            <Sparkline values={curve.cumulative} height="sm" label="Spending so far this period" />
          </Tile>
          <Tile label="Income" cents={safe.income_received_cents} tone="success" to="/spending" spoken={`Income received ${spokenMoney(safe.income_received_cents)} of ${spokenMoney(safe.income_cents)} expected`}>
            <Meter value={incomeShare} tone="success" label={`${Math.round(incomeShare * 100)} percent of the expected income received`} />
            <Text variant="caption" tone="muted">{`of ${formatMoney(safe.income_cents)} expected`}</Text>
          </Tile>
        </Row>
        <Row gap="md" align="stretch">
          <Tile label="Still to pay" cents={safe.fixed_costs_due_cents} tone="warning" to="/subscriptions" spoken={`Still to pay ${spokenMoney(safe.fixed_costs_due_cents)} in fixed costs`}>
            <Text variant="caption" tone="muted">fixed costs due before the period ends</Text>
          </Tile>
          <Tile label="Left to spend" cents={safe.available_cents} tone="info" to="/budget" bad={safe.income_detected && safe.available_cents < 0} spoken={`Left to spend ${spokenMoney(safe.available_cents)}`}>
            <Meter value={leftShare} tone="info" label={`${Math.round(leftShare * 100)} percent of the income is still free`} />
            <Text variant="caption" tone="muted">{safe.income_cents > 0 ? `${Math.round(leftShare * 100)} % of income` : "free this period"}</Text>
          </Tile>
        </Row>
      </Box>
    </Box>
  );
}

function Tile({ label, cents, tone, to, spoken, chip, bad, children }: { label: string; cents: number; tone: Tone; to: Route; spoken: string; chip?: ReactNode; bad?: boolean; children?: ReactNode }) {
  const router = useRouter();
  return (
    <Box equal>
      <Touchable onPress={() => router.push(to)} label={`${spoken}. Opens the details.`} bg={`${tone}-soft`} radius="3xl" p="md" gap="xs" grow>
        <Row justify="between" gap="sm">
          <Box grow><Text variant="label" tone={`on-${tone}-soft`} numberOfLines={1}>{label}</Text></Box>
          <Box dim="icon-lg" radius="full" bg={`${tone}-solid`} align="center" justify="center"><Icon name="arrow-top-right" size="xs" tone={`on-${tone}-solid`} /></Box>
        </Row>
        <Row gap="sm" wrap>
          <Text variant="heading" tone={bad ? "danger" : `on-${tone}-soft`} fit>{formatMoney(cents)}</Text>
          {chip}
        </Row>
        <Box gap="xs" justify="end" grow>{children}</Box>
      </Touchable>
    </Box>
  );
}
