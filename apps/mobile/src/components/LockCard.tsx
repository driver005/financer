import { useEffect, useState } from "react";
import { Platform, View } from "react-native";

import { HelperText, Switch, Text } from "@/components/kit";
import { Card, useColors } from "@/components/ui";
import { refreshLockAvailability, setAppLockEnabled, useAppLock } from "@/native/appLock";

/** Settings card for the app lock. Not shown in the browser, where there is nothing to unlock with. */
export function LockCard() {
  const view = useAppLock();
  const c = useColors();
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refreshLockAvailability();
  }, []);

  if (Platform.OS === "web") return null;
  const available = view.availability?.available === true;
  const reason = view.availability && !view.availability.available ? view.availability.reason : null;

  async function toggle(next: boolean) {
    setBusy(true);
    setMessage(null);
    const r = await setAppLockEnabled(next);
    setMessage(r.message);
    setBusy(false);
  }

  return (
    <Card>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Text variant="titleMedium">Lock the app</Text>
          <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
            Ask for your fingerprint, face or phone passcode when the app opens and when you come back to it after more
            than a minute. It keeps other people out of the app on your unlocked phone; it does not protect the data
            against someone who has taken apart a rooted phone.
          </Text>
        </View>
        <Switch
          value={view.state.enabled}
          onValueChange={(v) => !busy && (available || !v) && void toggle(v)}
          accessibilityLabel="Lock the app"
        />
      </View>
      {reason && !view.state.enabled ? <HelperText type="info" visible>{reason}</HelperText> : null}
      {view.notice ? <HelperText type="error" visible>{view.notice}</HelperText> : null}
      {message ? <HelperText type="error" visible>{message}</HelperText> : null}
    </Card>
  );
}
