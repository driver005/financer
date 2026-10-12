import { useCallback, useState } from "react";
import { FlatList, RefreshControl, Text, View } from "react-native";
import { useFocusEffect } from "expo-router";

import type { Alert } from "@/api/client";
import { useApi } from "@/api/config";
import { ChunkyButton } from "@/components/kit";
import { EmptyState, FieldMessage, SettingsGroup, SettingsToggleRow } from "@/components/settings/SettingsKit";
import { Badge, CountBubble } from "@/components/Watchdog";
import { Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";
import { alertKindLabel, alertText, sortAlerts, SEVERITY_LABEL } from "@/watchdog";

const TONE = { high: "bad", medium: "warn", low: "muted" } as const;

export default function Alerts() {
  const { api, loaded } = useApi();
  const c = useColors();
  const [alerts, setAlerts] = useState<Alert[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [showDismissed, setShowDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(
    async (withDismissed: boolean) => {
      if (!api) return;
      setBusy(true);
      try {
        const r = await api.alerts(withDismissed);
        setAlerts(sortAlerts(r.alerts));
        setUnread(r.unread_count);
        setMessage(null);
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not load alerts");
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  useFocusEffect(
    useCallback(() => {
      void load(showDismissed);
    }, [load, showDismissed]),
  );

  const dismiss = useCallback(
    async (alert: Alert) => {
      if (!api) return;
      try {
        await api.dismissAlert(alert.id);
        // keep it in the list (greyed out) when dismissed ones are shown, otherwise drop it
        setAlerts((list) =>
          (list ?? []).flatMap((a) => (a.id !== alert.id ? [a] : showDismissed ? [{ ...a, dismissed: true }] : [])),
        );
        setUnread((n) => Math.max(0, n - (alert.dismissed ? 0 : 1)));
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not dismiss the alert");
        void load(showDismissed);
      }
    },
    [api, load, showDismissed],
  );

  if (!loaded) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        <Title>Alerts</Title>
        <CountBubble count={unread} label={`${unread} unread alerts`} />
      </View>
      {!api ? (
        <NeedsSetup />
      ) : (
        <FlatList
          data={alerts ?? []}
          keyExtractor={(a) => a.id}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={() => load(showDismissed)} />}
          contentContainerStyle={{ paddingBottom: 24 }}
          ListHeaderComponent={
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: c.muted, fontSize: 14, marginBottom: 12 }}>
                Payments from the last 60 days that look odd: charged twice, far above the usual, a big first-time merchant, or large for the category. These are hints, not proof.
              </Text>
              <SettingsGroup>
                <SettingsToggleRow icon="eye-off-outline" title="Show dismissed" value={showDismissed} onValueChange={setShowDismissed} />
              </SettingsGroup>
              {message ? <FieldMessage tone="error">{message}</FieldMessage> : null}
            </View>
          }
          ListEmptyComponent={
            alerts === null ? (
              <Loading />
            ) : showDismissed ? (
              <EmptyState mood="happy" title="No alerts at all" body="Nothing has looked odd in the last 60 days, dismissed or not." />
            ) : (
              <EmptyState mood="cheer" title="All quiet" body="No payment looks odd right now. New hints show up here after a sync or an import." />
            )
          }
          renderItem={({ item }) => (
            <Card style={{ opacity: item.dismissed ? 0.6 : 1 }}>
              <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <Badge tone={TONE[item.severity as keyof typeof TONE] ?? "muted"} text={SEVERITY_LABEL[item.severity] ?? item.severity} />
                <Badge text={alertKindLabel(item.kind)} />
                {item.dismissed ? <Badge text="Dismissed" /> : null}
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: c.text, fontSize: 16, fontWeight: "800" }} numberOfLines={1}>{item.counterparty || "Unknown"}</Text>
                  <Text style={{ color: c.muted, fontSize: 13 }}>{formatDate(item.booking_date)}</Text>
                </View>
                <Text style={{ color: c.text, fontSize: 16, fontWeight: "800" }}>{formatCents(-item.amount_cents)}</Text>
              </View>
              <Text style={{ color: c.text, marginTop: 8 }}>{alertText(item)}</Text>
              {item.dismissed ? null : (
                <View style={{ marginTop: 12, alignSelf: "flex-start" }}>
                  <ChunkyButton compact style={{ minHeight: 44 }} outline label="Dismiss" icon="check" onPress={() => dismiss(item)} />
                </View>
              )}
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
