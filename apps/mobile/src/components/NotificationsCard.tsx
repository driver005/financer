import { useCallback, useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";

import { useApi } from "@/api/config";
import { Button, Card, useColors } from "@/components/ui";
import { HelperText, Switch, Text } from "@/components/kit";
import { refreshBackgroundRegistration } from "@/native/background";
import {
  getPrefs,
  notificationsSupported,
  permissionState,
  runNotificationChecks,
  scheduledSummary,
  setKindEnabled,
  type PermissionState,
} from "@/native/notifications";
import { DEFAULT_PREFS, type NotifyKind, type NotifyPrefs } from "@/notifyPlan";
import { formatDate } from "@/format";

const ROWS: { kind: NotifyKind; title: string; hint: string }[] = [
  { kind: "evening", title: "Evening check", hint: "Around 18:00: what is still safe to spend today." },
  { kind: "payday", title: "Payday reminder", hint: "Around 08:00 on the day your next budget period starts." },
  { kind: "priceDrop", title: "Price drops", hint: "When something from your usual items gets cheaper. Needs your own list (My list or receipts)." },
];

/**
 * Settings: one switch per kind of local notification, the permission state and an honest note on
 * timing. Does nothing on the web or in a build without the notification module.
 */
export function NotificationsCard() {
  const { api } = useApi();
  const c = useColors();
  const [supported, setSupported] = useState<boolean | null>(null);
  const [prefs, setPrefs] = useState<NotifyPrefs>(DEFAULT_PREFS);
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  const [next, setNext] = useState<{ evening: string | null; payday: string | null }>({ evening: null, payday: null });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const ok = await notificationsSupported();
    setSupported(ok);
    if (!ok) return;
    setPrefs(await getPrefs());
    setPermission(await permissionState());
    setNext(await scheduledSummary());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function toggle(kind: NotifyKind, on: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      const r = await setKindEnabled(kind, on);
      setPrefs(r.prefs);
      setPermission(r.permission);
      if (on && r.permission === "denied") setMessage("Notifications are blocked for Financer. Allow them in the phone's settings, then switch this on again.");
      else if (on && r.permission !== "granted") setMessage("This build cannot show notifications.");
      await refreshBackgroundRegistration().catch(() => false);
      if (api) await runNotificationChecks(api);
      setNext(await scheduledSummary());
    } catch {
      setMessage("Could not change this. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (supported === null) return null;

  if (!supported) {
    return (
      <Card>
        <Text variant="titleMedium">Notifications</Text>
        <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
          {Platform.OS === "web"
            ? "Reminders and price alerts need the phone app; the web version cannot show them."
            : "This build does not include notifications."}
        </Text>
      </Card>
    );
  }

  return (
    <Card>
      <Text variant="titleMedium">Notifications</Text>
      <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
        Your phone schedules these itself; no server sends anything. Amounts can show on the lock screen.
      </Text>

      {ROWS.map((row) => (
        <View key={row.kind} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 14 }}>
          <View style={{ flex: 1 }}>
            <Text variant="titleSmall">{row.title}</Text>
            <Text variant="bodySmall" style={{ color: c.muted }}>
              {row.hint}
            </Text>
            {row.kind === "evening" && prefs.evening && next.evening ? (
              <Text variant="bodySmall" style={{ color: c.muted }}>
                Next: {formatDate(next.evening)}
              </Text>
            ) : null}
            {row.kind === "payday" && prefs.payday && next.payday ? (
              <Text variant="bodySmall" style={{ color: c.muted }}>
                Next: {formatDate(next.payday)}
              </Text>
            ) : null}
          </View>
          <Switch value={prefs[row.kind]} onValueChange={(v) => !busy && void toggle(row.kind, v)} accessibilityLabel={row.title} />
        </View>
      ))}

      {permission === "denied" ? (
        <View style={{ marginTop: 12 }}>
          <HelperText type="error" visible>
            Notifications are blocked for Financer in the phone's settings.
          </HelperText>
          <Button label="Open phone settings" icon="cog-outline" mode="outlined" onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}
      {message ? <HelperText type="info" visible>{message}</HelperText> : null}

      <Text variant="titleSmall" style={{ marginTop: 16 }}>
        What to expect
      </Text>
      <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
        The evening message and the payday reminder are set up in advance, with the numbers from the last time the app ran, so
        they can be a little behind and may arrive a few minutes off. Price drops are looked for when you open the app and
        when iOS or Android lets Financer run in the background. The system decides how often, and may not do it at all (for
        example in battery saver mode, or if you rarely open the app), so an alert can come late or be missed. Each drop is
        announced once.
      </Text>
    </Card>
  );
}
