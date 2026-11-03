import { Badge, Box, Card, ColumnChart, Money, Row, Text } from "@financer/ui";

import { formatMoney } from "@/format";
import { lastWeek, weekSummary } from "@/todayCharts";

/**
 * The last seven days as columns, today in the strong colour, with the daily average as a dotted
 * line and the change against the week before next to the total.
 */
export function WeekCard({ txs, today }: { txs: { booking_date: string; amount_cents: number; category?: string | null }[]; today: string }) {
  const week = lastWeek(txs, today);
  return (
    <Card gap="md">
      <Row justify="between" align="start" gap="md">
        <Box>
          <Text variant="label" tone="muted">Last 7 days</Text>
          <Money cents={week.total} variant="title" tone="plain" />
        </Box>
        {week.deltaPercent !== null && week.deltaPercent !== 0 ? (
          <Badge tone={week.deltaPercent > 0 ? "warning" : "success"} icon={week.deltaPercent > 0 ? "arrow-up" : "arrow-down"} label={`${Math.abs(week.deltaPercent)} %`} />
        ) : null}
      </Row>
      <ColumnChart
        summary={weekSummary(week)}
        average={week.average}
        columns={week.bars.map((b) => ({ key: b.iso, value: b.cents, label: b.letter, strong: b.today, note: `${Math.round(b.cents / 100)} €` }))}
      />
      <Text variant="caption" tone="muted">{week.total > 0 ? `Average ${formatMoney(week.average)} a day` : "Nothing spent in the last 7 days"}</Text>
    </Card>
  );
}
