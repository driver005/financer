import { useCallback, useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import type { Subscriptions } from "@/api/client";
import { useApi } from "@/api/config";
import { EmptyState, FieldMessage, Segmented } from "@/components/settings/SettingsKit";
import { Badge } from "@/components/Watchdog";
import { Body, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";
import { badgesFor, cadenceLabel, duplicateText, groupByWeek, hikeText, shortDate, staleText } from "@/watchdog";

const HORIZONS = ["30", "60", "90"] as const;
type Horizon = (typeof HORIZONS)[number];

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ color: c.text, fontSize: 18, fontWeight: "800", marginBottom: 2 }} accessibilityRole="header">
        {title}
      </Text>
      {hint ? <Text style={{ color: c.muted, fontSize: 13, marginBottom: 8 }}>{hint}</Text> : null}
      {children}
    </View>
  );
}

export default function SubscriptionsScreen() {
  const { api, loaded } = useApi();
  const c = useColors();
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

  if (!loaded) return <Screen><Loading /></Screen>;

  const weeks = data ? groupByWeek(data.upcoming, data.as_of) : [];
  const nothing = data && data.active.length === 0 && data.stale.length === 0;

  return (
    <Screen>
      <Title>Subscriptions</Title>
      {!api ? (
        <NeedsSetup />
      ) : !data ? (
        error ? <FieldMessage tone="error">{error}</FieldMessage> : <Loading />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={() => load(days)} />}
        >
          {nothing ? (
            <EmptyState
              mood="happy"
              title="No recurring payments yet"
              body="A payment counts once it has been booked three times on a steady rhythm. Import more history from your bank to find more."
            />
          ) : (
            <Card>
              <Text style={{ color: c.muted, fontSize: 12, fontWeight: "800", letterSpacing: 1 }}>RUNNING SUBSCRIPTIONS</Text>
              <Text style={{ color: c.text, fontSize: 26, fontWeight: "800", marginTop: 4 }}>{formatCents(data.monthly_total_cents)} / month</Text>
              <Text style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>
                {data.active.length} recurring payment{data.active.length === 1 ? "" : "s"}, yearly and quarterly ones averaged per month.
              </Text>
            </Card>
          )}

          {data.price_hikes.length > 0 ? (
            <Section title="Price increases" hint="The latest charge is higher than the one before.">
              {data.price_hikes.map((h) => (
                <Card key={`${h.counterparty}-${h.since}`}>
                  <Badge tone="bad" text={`${h.counterparty}: ${formatCents(h.old_amount_cents)} to ${formatCents(h.new_amount_cents)}`} />
                  <Text style={{ color: c.text, marginTop: 8 }}>{hikeText(h)}</Text>
                </Card>
              ))}
            </Section>
          ) : null}

          {data.duplicates.length > 0 ? (
            <Section title="Possible duplicates" hint="Same or very similar merchant, same rhythm, similar amount.">
              {data.duplicates.map((d) => (
                <Card key={`${d.first.counterparty}-${d.first.amount_cents}-${d.second.counterparty}-${d.second.amount_cents}-${d.first.last_date}`}>
                  <Badge tone="warn" text={d.reason === "same_merchant" ? "Billed twice" : "Similar merchants"} />
                  <Text style={{ color: c.text, marginTop: 8 }}>{duplicateText(d)}</Text>
                </Card>
              ))}
            </Section>
          ) : null}

          <Section title="Coming up">
            <Segmented<Horizon>
              value={days}
              onValueChange={setDays}
              buttons={HORIZONS.map((h) => ({ value: h, label: `${h} days` }))}
              style={{ marginBottom: 12 }}
            />
            {weeks.length === 0 ? (
              <Body muted>No charges expected in the next {days} days.</Body>
            ) : (
              weeks.map((w) => (
                <Card key={w.key}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
                    <Text style={{ color: c.text, fontSize: 16, fontWeight: "800" }}>{w.label}</Text>
                    <Text style={{ color: c.muted, fontWeight: "800" }}>{formatCents(w.totalCents)}</Text>
                  </View>
                  {w.items.map((u) => {
                    const badges = badgesFor(u, data);
                    return (
                      <View
                        key={`${u.date}-${u.counterparty}`}
                        style={{ paddingVertical: 8 }}
                        accessibilityLabel={`${u.counterparty}, ${formatCents(u.amount_cents)}, ${formatDate(u.date)}${u.overdue ? ", not booked yet" : ""}`}
                      >
                        <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: c.text, fontSize: 16, fontWeight: "700" }} numberOfLines={1}>{u.counterparty}</Text>
                            <Text style={{ color: c.muted, fontSize: 13 }}>
                              {shortDate(u.date)} · {cadenceLabel(u.cadence)}
                            </Text>
                          </View>
                          <Text style={{ color: c.text, fontSize: 16, fontWeight: "700" }}>{formatCents(u.amount_cents)}</Text>
                        </View>
                        {badges.length > 0 ? (
                          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
                            {badges.map((b) => (
                              <Badge key={b.id} text={b.text} tone={b.tone} />
                            ))}
                          </View>
                        ) : null}
                      </View>
                    );
                  })}
                </Card>
              ))
            )}
          </Section>

          {data.stale.length > 0 ? (
            <Section title="Possibly unused" hint="No charge for two or more periods: cancelled, paused or moved. Not part of the calendar.">
              {data.stale.map((s) => (
                <Card key={`${s.subscription.counterparty}-${s.subscription.last_date}`}>
                  <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                    <Text style={{ color: c.text, fontSize: 16, fontWeight: "700", flex: 1 }} numberOfLines={1}>
                      {s.subscription.counterparty}
                    </Text>
                    <Badge text={`${s.days_since_last} days ago`} />
                  </View>
                  <Text style={{ color: c.muted, marginTop: 6 }}>{staleText(s)}</Text>
                </Card>
              ))}
            </Section>
          ) : null}
        </ScrollView>
      )}
    </Screen>
  );
}
