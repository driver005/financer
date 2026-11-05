import { useRouter } from "expo-router";
import { Box, Button, Card, Dot, DonutChart, Row, Text, useSeriesColor } from "@financer/ui";

import { formatMoney, spokenMoney } from "@/format";
import { periodLabel } from "@/period";
import { categoryShares, sharesSummary } from "@/todayCharts";

/**
 * Where the period's money went: a donut with the total in the middle and, beside it, one legend
 * row per category with its amount and share. The colours only tell the slices apart; every row
 * names its category, so nothing depends on telling hues apart.
 */
export function CategoryCard({ txs, period, link = true }: { txs: { booking_date: string; amount_cents: number; category?: string | null }[]; period: { start: string; end: string }; /** Offer the button to the full list (not on the list itself). */ link?: boolean }) {
  const router = useRouter();
  const colour = useSeriesColor();
  const { total, shares } = categoryShares(txs, period, 5);
  if (shares.length === 0) return null;

  return (
    <Card gap="md">
      <Row justify="between" gap="md">
        <Box grow>
          <Text variant="bodyStrong" level={3}>Where it went</Text>
          <Text variant="caption" tone="muted">{periodLabel(period)}</Text>
        </Box>
        {link ? <Button label="All spending" size="sm" variant="ghost" onPress={() => router.push("/spending")} /> : null}
      </Row>
      <Row gap="lg" wrap align="center">
        <DonutChart
          slices={shares.map((s) => ({ key: s.category, share: s.share, other: s.category === "other" }))}
          centre={formatMoney(total)}
          caption="Spent"
          summary={sharesSummary(total, shares)}
        />
        <Box grow gap="sm">
          {shares.map((s, i) => (
            <Row key={s.category} gap="sm" accessible accessibilityLabel={`${s.label}: ${spokenMoney(s.cents)}, ${Math.round(s.share * 100)} percent`}>
              <Dot color={colour(i, s.category === "other")} />
              <Box grow>
                <Text variant="label" numberOfLines={1}>{s.label}</Text>
                <Text variant="caption" tone="muted" numberOfLines={1}>{formatMoney(s.cents)}</Text>
              </Box>
              <Text variant="number" numberOfLines={1}>{`${Math.round(s.share * 100)} %`}</Text>
            </Row>
          ))}
        </Box>
      </Row>
    </Card>
  );
}
