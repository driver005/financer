import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Box, Note, Text, ToggleRow } from "@financer/ui";

import { refreshLockAvailability, setAppLockEnabled, useAppLock } from "@/native/appLock";

/** Settings row for the app lock. Not shown in the browser, where there is nothing to unlock with. */
export function LockCard() {
  const view = useAppLock();
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
    <Box>
      <ToggleRow
        icon="fingerprint"
        title="Lock the app"
        subtitle="Ask for your fingerprint, face or phone passcode when the app opens and when you come back after more than a minute."
        value={view.state.enabled}
        onChange={(v) => !busy && (available || !v) && void toggle(v)}
      />
      <Box gap="xs" pb="md">
        <Text variant="caption" tone="muted">It keeps other people out of the app on your unlocked phone; it does not protect the data against someone who has taken apart a rooted phone.</Text>
        {reason && !view.state.enabled ? <Note>{reason}</Note> : null}
        {view.notice ? <Note tone="error">{view.notice}</Note> : null}
        {message ? <Note tone="error">{message}</Note> : null}
      </Box>
    </Box>
  );
}
