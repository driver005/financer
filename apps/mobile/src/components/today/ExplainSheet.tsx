import { Box, Divider, Money, Row, Sheet, Text } from "@financer/ui";

import type { SafeToSpend } from "@/api/client";
import { formatMoney, spokenMoney } from "@/format";
import { periodLabel } from "@/period";
import { breakdownRows, paceInfo } from "@/safeToSpend";

/** Bottom sheet with the numbers behind the daily amount. */
export function ExplainSheet({ data, visible, onClose }: { data: SafeToSpend; visible: boolean; onClose: () => void }) {
  const rows = breakdownRows(data);
  const pace = paceInfo(data);
  const label = periodLabel({ start: data.period_start, end: data.period_end });
  return (
    <Sheet visible={visible} onClose={onClose} title="How your daily number works">
      <Box gap="md">
        <Text variant="caption" tone="muted">{`Budget period ${label}`}</Text>
        {rows.map((r) => (
          <Box key={r.id} gap="2xs" accessible accessibilityLabel={`${r.label}: ${spokenMoney(r.cents)}. ${r.hint}`}>
            <Row justify="between" gap="md">
              <Box grow><Text variant="bodyStrong">{r.label}</Text></Box>
              <Money cents={r.cents} variant="bodyStrong" signed tone={r.cents < 0 ? "bad" : "good"} />
            </Row>
            <Text variant="caption" tone="muted">{r.hint}</Text>
          </Box>
        ))}
        <Divider />
        <Row justify="between" gap="md">
          <Box grow><Text variant="bodyStrong">Free to spend</Text></Box>
          <Text variant="number">{formatMoney(data.available_cents)}</Text>
        </Row>
        <Row justify="between" gap="md">
          <Box grow><Text variant="bodyStrong">{`Divided by ${Math.max(1, data.days_left)} ${data.days_left <= 1 ? "day (today)" : "days left"}`}</Text></Box>
          <Text variant="number">{`${formatMoney(data.daily_cents)} a day`}</Text>
        </Row>
        <Text variant="bodyStrong">{`Pace: ${pace.title}`}</Text>
        <Text variant="caption" tone="muted">{pace.detail}</Text>
        <Text variant="caption" tone="muted">
          Based on recurring payments found in your bookings and your envelope limits. A payment that is long overdue is treated as stopped. This is a budget estimate, not your bank balance.
        </Text>
      </Box>
    </Sheet>
  );
}
