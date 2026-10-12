import { useEffect, useState } from "react";
import { Linking, Platform, View } from "react-native";

import { useApi } from "@/api/config";
import { ChunkyButton, Switch, Text } from "@/components/kit";
import { FieldMessage } from "@/components/settings/SettingsKit";
import { ChoiceCard, FieldLabel, StepFrame } from "@/components/onboarding/Frame";
import type { StepCtx } from "@/components/onboarding/types";
import { Card, useColors } from "@/components/ui";
import { refreshLockAvailability, setAppLockEnabled, useAppLock } from "@/native/appLock";
import { refreshBackgroundRegistration } from "@/native/background";
import {
  notificationsSupported,
  permissionState,
  runNotificationChecks,
  setKindEnabled,
  type PermissionState,
} from "@/native/notifications";
import type { NotifyKind } from "@/notifyPlan";
import { mascotFor } from "@/onboarding";

const KINDS: { kind: NotifyKind; icon: string; title: string; body: string }[] = [
  { kind: "evening", icon: "weather-night", title: "Evening check", body: "Around 18:00: what is still safe to spend today." },
  { kind: "payday", icon: "calendar-star", title: "Payday reminder", body: "Around 08:00 on the day your next budget period starts." },
  { kind: "priceDrop", icon: "tag-arrow-down-outline", title: "Price drops", body: "When something from your usual items gets cheaper. Needs your own list or receipts." },
];

/** App lock and notifications. Only part of the phone app: the step list leaves it out on the web. */
export function SafetyStep({ ctx }: { ctx: StepCtx }) {
  const { api } = useApi();
  const c = useColors();
  const lock = useAppLock();
  const [lockMessage, setLockMessage] = useState<string | null>(null);
  const [lockBusy, setLockBusy] = useState(false);
  const [supported, setSupported] = useState<boolean | null>(null);
  const [picked, setPicked] = useState<NotifyKind[]>((ctx.draft.notifyKinds as NotifyKind[] | undefined) ?? ["evening", "payday"]);
  const [permission, setPermission] = useState<PermissionState>("unsupported");
  const [notifyBusy, setNotifyBusy] = useState(false);
  const [notifyMessage, setNotifyMessage] = useState<string | null>(null);

  useEffect(() => {
    void refreshLockAvailability();
    void (async () => {
      const ok = await notificationsSupported();
      setSupported(ok);
      if (ok) setPermission(await permissionState());
    })();
  }, []);

  const lockAvailable = lock.availability?.available === true;
  const lockReason = lock.availability && !lock.availability.available ? lock.availability.reason : null;

  async function toggleLock(next: boolean) {
    setLockBusy(true);
    setLockMessage(null);
    const r = await setAppLockEnabled(next);
    setLockMessage(r.message);
    if (r.ok) ctx.update({ lockOn: next });
    setLockBusy(false);
  }

  // The system permission prompt is shown here and nowhere earlier: after the three kinds are explained.
  async function turnOn() {
    setNotifyBusy(true);
    setNotifyMessage(null);
    const on: NotifyKind[] = [];
    try {
      let last: PermissionState = permission;
      for (const kind of picked) {
        const r = await setKindEnabled(kind, true);
        last = r.permission;
        if (r.prefs[kind]) on.push(kind);
        if (r.permission !== "granted") break;
      }
      setPermission(last);
      ctx.update({ notifyKinds: on });
      if (picked.length && on.length === 0) {
        setNotifyMessage(
          last === "denied"
            ? "Notifications are blocked for Financer. Allow them in the phone's settings, then try again."
            : "This build cannot show notifications.",
        );
      } else if (on.length) {
        setNotifyMessage(`${on.length} reminder${on.length === 1 ? "" : "s"} switched on. You can change them in Settings.`);
      }
      await refreshBackgroundRegistration().catch(() => false);
      if (api) await runNotificationChecks(api);
    } catch {
      setNotifyMessage("Could not change this. Try again.");
    } finally {
      setNotifyBusy(false);
    }
  }

  const toggleKind = (kind: NotifyKind) => setPicked((cur) => (cur.includes(kind) ? cur.filter((k) => k !== kind) : [...cur, kind]));

  return (
    <StepFrame
      fraction={ctx.fraction}
      stepLabel={ctx.stepLabel}
      onBack={ctx.back}
      backIsClose={ctx.backIsClose}
      mascot={mascotFor("safety", ctx.draft, ctx.build)}
      title="Small safety and nudges"
      why="Both are optional and easy to change later in Settings."
      primary={{ label: "Continue", onPress: ctx.next, icon: "arrow-right" }}
      onSkip={ctx.next}
    >
      <Card>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text variant="titleMedium">Lock the app</Text>
            <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
              Why: your phone may be unlocked on a table, and this app holds your bookings. It asks for your fingerprint, face or phone passcode when the app opens and when you come back after more than a minute. It keeps other people out; it does not protect the data against someone who takes a rooted phone apart.
            </Text>
          </View>
          <Switch
            value={lock.state.enabled}
            onValueChange={(v) => !lockBusy && (lockAvailable || !v) && void toggleLock(v)}
            accessibilityLabel="Lock the app"
          />
        </View>
        {lockReason && !lock.state.enabled ? <FieldMessage tone="info">{lockReason}</FieldMessage> : null}
        {lock.notice ? <FieldMessage tone="error">{lock.notice}</FieldMessage> : null}
        {lockMessage ? <FieldMessage tone="error">{lockMessage}</FieldMessage> : null}
      </Card>

      <FieldLabel>Reminders</FieldLabel>
      {supported === false ? (
        <FieldMessage tone="info">
          {Platform.OS === "web" ? "Reminders need the phone app." : "This build does not include notifications."}
        </FieldMessage>
      ) : (
        <>
          <Text variant="bodySmall" style={{ color: c.muted, marginBottom: 10 }}>
            Why: a nudge at the right moment is worth more than a number you have to go and look up. Your phone schedules these itself; no server sends anything. Amounts can show on the lock screen. Pick the ones you want, then allow notifications.
          </Text>
          {KINDS.map((k) => (
            <ChoiceCard key={k.kind} role="checkbox" icon={k.icon} title={k.title} body={k.body} selected={picked.includes(k.kind)} onPress={() => toggleKind(k.kind)} />
          ))}
          {permission === "granted" && (ctx.draft.notifyKinds?.length ?? 0) > 0 ? null : (
            <ChunkyButton
              icon="bell-ring-outline"
              label={notifyBusy ? "Asking…" : "Allow notifications"}
              onPress={() => void turnOn()}
              disabled={notifyBusy || picked.length === 0 || supported === null}
            />
          )}
          {permission === "denied" ? (
            <View style={{ marginTop: 8 }}>
              <ChunkyButton outline icon="cog-outline" label="Open phone settings" onPress={() => void Linking.openSettings()} />
            </View>
          ) : null}
          {notifyMessage ? <FieldMessage tone="info">{notifyMessage}</FieldMessage> : null}
          <Text variant="bodySmall" style={{ color: c.muted, marginTop: 8 }}>
            The evening message and payday reminder are scheduled in advance and may arrive a few minutes off. Price drops are looked for when you open the app and when the system lets Financer run in the background, so they can come late.
          </Text>
        </>
      )}
    </StepFrame>
  );
}
