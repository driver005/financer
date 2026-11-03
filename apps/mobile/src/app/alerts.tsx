import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";
import { Badge, Button, Card, Group, Money, Row, Box, Note, Text, ToggleRow, VirtualList } from "@financer/ui";

import type { Alert } from "@/api/client";
import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { CountBubble } from "@/components/Watchdog";
import { formatDate } from "@/format";
import { alertKindLabel, alertText, sortAlerts, SEVERITY_LABEL } from "@/watchdog";

const TONE = { high: "danger", medium: "warning", low: "neutral" } as const;

export default function Alerts() {
  const { api, loaded } = useApi();
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
        // keep it in the list (marked) when dismissed ones are shown, otherwise drop it
        setAlerts((list) => (list ?? []).flatMap((a) => (a.id !== alert.id ? [a] : showDismissed ? [{ ...a, dismissed: true }] : [])));
        setUnread((n) => Math.max(0, n - (alert.dismissed ? 0 : 1)));
      } catch (e) {
        setMessage(e instanceof Error ? e.message : "Could not dismiss the alert");
        void load(showDismissed);
      }
    },
    [api, load, showDismissed],
  );

  if (!loaded) return <Page title="Alerts"><Loading /></Page>;
  if (!api) return <Page title="Alerts"><NeedsSetup /></Page>;

  return (
    <Page title="Alerts" actions={<CountBubble count={unread} />} fixed>
      <VirtualList
        data={alerts ?? []}
        keyExtractor={(a) => a.id}
        refreshing={busy}
        onRefresh={() => load(showDismissed)}
        header={
          <Box gap="md">
            <Text variant="label" tone="muted">
              Payments from the last 60 days that look odd: charged twice, far above the usual, a big first-time merchant, or large for the category. These are hints, not proof.
            </Text>
            <Group>
              <ToggleRow icon="eye-off-outline" title="Show dismissed" value={showDismissed} onChange={setShowDismissed} />
            </Group>
            {message ? <Note tone="error">{message}</Note> : null}
          </Box>
        }
        empty={
          alerts === null ? (
            <Loading rows={3} />
          ) : showDismissed ? (
            <Empty mood="happy" title="No alerts at all" message="Nothing has looked odd in the last 60 days, dismissed or not." />
          ) : (
            <Empty mood="cheer" title="All quiet" message="No payment looks odd right now. New hints show up here after a sync or an import." />
          )
        }
        renderItem={(item) => (
          <Card variant={item.dismissed ? "flat" : "raised"} gap="sm">
            <Row gap="sm" wrap>
              <Badge tone={TONE[item.severity as keyof typeof TONE] ?? "neutral"} label={SEVERITY_LABEL[item.severity] ?? item.severity} />
              <Badge label={alertKindLabel(item.kind)} />
              {item.dismissed ? <Badge label="Dismissed" /> : null}
            </Row>
            <Row justify="between" gap="md" align="start">
              <Box grow>
                <Text variant="bodyStrong" numberOfLines={1}>{item.counterparty || "Unknown"}</Text>
                <Text variant="caption" tone="muted">{formatDate(item.booking_date)}</Text>
              </Box>
              <Money cents={-item.amount_cents} variant="bodyStrong" tone="plain" />
            </Row>
            <Text variant="body">{alertText(item)}</Text>
            {item.dismissed ? null : <Row><Button label="Dismiss" icon="check" variant="outline" size="sm" onPress={() => dismiss(item)} /></Row>}
          </Card>
        )}
      />
    </Page>
  );
}
