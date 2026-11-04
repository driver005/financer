import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Badge, Box, Card, HeroCaption, HeroCard, HeroChip, HeroFigure, Money, Note, Row, Section, Segmented, Text } from "@financer/ui";

import type { Subscriptions } from "@/api/client";
import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { formatCents, formatDate } from "@/format";
import { toTone } from "@/uiTone";
import { badgesFor, cadenceLabel, duplicateText, groupByWeek, hikeText, shortDate, staleText } from "@/watchdog";

const HORIZONS = ["30", "60", "90"] as const;
type Horizon = (typeof HORIZONS)[number];

export default function SubscriptionsScreen() {
  const { api, loaded } = useApi();
  const [days, setDays] = useState<Horizon>("30");
  const [data, setData] = useState<Subscriptions | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    async (horizon: Horizon) => {
      if (!api) return;
      setBusy(true);
      try {
        setData(await api.subscriptions(Number(horizon)));
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load subscriptions");
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  useFocusEffect(
    useCallback(() => {
      void load(days);
    }, [load, days]),
  );

  if (!loaded) return <Page title="Subscriptions"><Loading /></Page>;
  if (!api) return <Page title="Subscriptions"><NeedsSetup /></Page>;
  if (!data) return <Page title="Subscriptions">{error ? <Note tone="error">{error}</Note> : <Loading />}</Page>;

  const weeks = groupByWeek(data.upcoming, data.date);
  const nothing = data.active.length === 0 && data.stale.length === 0;

  return (
    <Page title="Subscriptions" subtitle={busy ? "Refreshing…" : undefined}>
      {nothing ? (
        <Empty mood="happy" title="No recurring payments yet" message="A payment counts once it has been booked three times on a steady rhythm. Import more history from your bank to find more." />
      ) : (
        <HeroCard label="Running subscriptions" chip={<HeroChip text={`${data.active.length} active`} />}>
          <HeroFigure cents={data.monthly_total_cents} label={`Running subscriptions: ${formatCents(data.monthly_total_cents)} per month`} />
          <HeroCaption>per month · yearly and quarterly payments averaged</HeroCaption>
        </HeroCard>
      )}

      {data.price_hikes.length > 0 ? (
        <Section title="Price increases" description="The latest charge is higher than the one before.">
          {data.price_hikes.map((h) => (
            <Card key={`${h.counterparty}-${h.since}`} gap="sm">
              <Row><Badge tone="danger" label={`${h.counterparty}: ${formatCents(h.old_amount_cents)} to ${formatCents(h.new_amount_cents)}`} lines={2} /></Row>
              <Text variant="body">{hikeText(h)}</Text>
            </Card>
          ))}
        </Section>
      ) : null}

      {data.duplicates.length > 0 ? (
        <Section title="Possible duplicates" description="Same or very similar merchant, same rhythm, similar amount.">
          {data.duplicates.map((d) => (
            <Card key={`${d.first.counterparty}-${d.first.amount_cents}-${d.second.counterparty}-${d.second.amount_cents}-${d.first.last_date}`} gap="sm">
              <Row><Badge tone="warning" label={d.reason === "same_merchant" ? "Billed twice" : "Similar merchants"} /></Row>
              <Text variant="body">{duplicateText(d)}</Text>
            </Card>
          ))}
        </Section>
      ) : null}

      <Section title="Coming up">
        <Segmented<Horizon> value={days} onChange={setDays} options={HORIZONS.map((h) => ({ value: h, label: `${h} days` }))} />
        {weeks.length === 0 ? (
          <Text variant="body" tone="muted">No charges expected in the next {days} days.</Text>
        ) : (
          weeks.map((w) => (
            <Card key={w.key} gap="sm">
              <Row justify="between">
                <Text variant="bodyStrong">{w.label}</Text>
                <Money cents={w.totalCents} variant="number" tone="muted" />
              </Row>
              {w.items.map((u) => {
                const badges = badgesFor(u, data);
                return (
                  <Box key={`${u.date}-${u.counterparty}`} gap="xs" py="xs" accessible accessibilityLabel={`${u.counterparty}, ${formatCents(u.amount_cents)}, ${formatDate(u.date)}${u.overdue ? ", not booked yet" : ""}`}>
                    <Row justify="between" gap="md" align="start">
                      <Box grow>
                        <Text variant="bodyStrong" numberOfLines={1}>{u.counterparty}</Text>
                        <Text variant="caption" tone="muted">{shortDate(u.date)} · {cadenceLabel(u.cadence)}</Text>
                      </Box>
                      <Money cents={u.amount_cents} variant="bodyStrong" tone="plain" />
                    </Row>
                    {badges.length > 0 ? (
                      <Row gap="xs" wrap>
                        {badges.map((b) => (
                          <Badge key={b.id} label={b.text} tone={toTone(b.tone)} />
                        ))}
                      </Row>
                    ) : null}
                  </Box>
                );
              })}
            </Card>
          ))
        )}
      </Section>

      {data.stale.length > 0 ? (
        <Section title="Possibly unused" description="No charge for two or more periods: cancelled, paused or moved. Not part of the calendar.">
          {data.stale.map((s) => (
            <Card key={`${s.subscription.counterparty}-${s.subscription.last_date}`} gap="xs">
              <Row justify="between" gap="md">
                <Box grow><Text variant="bodyStrong" numberOfLines={1}>{s.subscription.counterparty}</Text></Box>
                <Badge label={`${s.days_since_last} days ago`} />
              </Row>
              <Text variant="caption" tone="muted">{staleText(s)}</Text>
            </Card>
          ))}
        </Section>
      ) : null}
    </Page>
  );
}
