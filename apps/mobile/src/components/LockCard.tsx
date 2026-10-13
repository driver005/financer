import { useEffect, useState } from "react";
import { Platform } from "react-native";

import { FieldMessage, PanelText, RowNotes, SettingsToggleRow } from "@/components/settings/SettingsKit";
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
    <>
      <SettingsToggleRow
        icon="fingerprint"
        title="Lock the app"
        subtitle="Ask for your fingerprint, face or phone passcode when the app opens and when you come back after more than a minute."
        value={view.state.enabled}
        onValueChange={(v) => !busy && (available || !v) && void toggle(v)}
      />
      <RowNotes>
        <PanelText style={{ marginTop: 0 }}>
          It keeps other people out of the app on your unlocked phone; it does not protect the data against someone who has taken apart a rooted phone.
        </PanelText>
        {reason && !view.state.enabled ? <FieldMessage tone="info">{reason}</FieldMessage> : null}
        {view.notice ? <FieldMessage tone="error">{view.notice}</FieldMessage> : null}
        {message ? <FieldMessage tone="error">{message}</FieldMessage> : null}
      </RowNotes>
    </>
  );
}
