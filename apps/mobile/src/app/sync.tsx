import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { ActivityIndicator, Text, TextInput } from "@/components/kit";
import { FieldMessage, SettingsGroup, SettingsToggleRow } from "@/components/settings/SettingsKit";
import { blzProblem, ibanProblem } from "@/settingsPlan";

import { ApiError } from "@/api/client";
import { liveSyncMissing } from "@/bankConnections";
import { useApi } from "@/api/config";
import { deleteSecret, getSecret, setSecret } from "@/api/storage";
import { Body, Button, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";
import { useScreenData } from "@/hooks";

const PIN_KEY = "financer.bank-pin";
const POLL_MS = 3000;
const GIVE_UP_MS = 10 * 60 * 1000;

type Phase = { kind: "idle" } | { kind: "waiting"; challenge: string } | { kind: "done"; text: string } | { kind: "error"; text: string };

export default function Sync() {
  const { api, loaded, mode } = useApi();
  const missing = liveSyncMissing(mode === "embedded");
  const c = useColors();
  const { data: status, reload } = useScreenData((a) => a.bankStatus());
  const [blz, setBlz] = useState("");
  const [userId, setUserId] = useState("");
  const [iban, setIban] = useState("");
  const [pin, setPin] = useState("");
  const [rememberPin, setRememberPin] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const cancelled = useRef(false);

  useEffect(() => {
    if (status) {
      setBlz((v) => v || status.blz || "");
      setUserId((v) => v || status.user_id || "");
      setIban((v) => v || status.iban || "");
    }
  }, [status]);

  useEffect(() => {
    getSecret(PIN_KEY).then((p) => {
      if (p) {
        setPin(p);
        setRememberPin(true);
      }
    });
    return () => {
      cancelled.current = true;
    };
  }, []);

  const start = useCallback(async () => {
    if (!api) return;
    cancelled.current = false;
    try {
      if (rememberPin) await setSecret(PIN_KEY, pin);
      else await deleteSecret(PIN_KEY);
      const started = await api.startSync({ blz, user_id: userId, pin, iban });
      setPhase({ kind: "waiting", challenge: started.no_tan_required ? "" : started.challenge });

      const deadline = Date.now() + GIVE_UP_MS;
      while (!cancelled.current && Date.now() < deadline) {
        try {
          const done = await api.confirmSync(started.sync_id);
          const balance = done.balance_cents != null ? ` Balance ${formatCents(done.balance_cents)}${done.balance_date ? ` (${formatDate(done.balance_date)})` : ""}.` : "";
          setPhase({ kind: "done", text: `Imported ${done.imported} new transactions, ${done.duplicates} were already known.${balance}` });
          await reload();
          return;
        } catch (e) {
          if (e instanceof ApiError && e.status === 409) {
            await new Promise((r) => setTimeout(r, POLL_MS));
            continue;
          }
          throw e;
        }
      }
      if (!cancelled.current) setPhase({ kind: "error", text: "Timed out waiting for the approval. Start again." });
    } catch (e) {
      setPhase({ kind: "error", text: e instanceof Error ? e.message : "Sync failed" });
    }
  }, [api, blz, userId, pin, iban, rememberPin, reload]);

  if (!loaded) return <Screen><Loading /></Screen>;

  const waiting = phase.kind === "waiting";
  const ready = blz.trim() && userId.trim() && iban.trim() && pin;

  return (
    <Screen>
      <Title>Sync with Sparkasse</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
          {status && !status.configured ? (
            <Card>
              <Body bold>{missing.title}</Body>
              <Text variant="bodyMedium" style={{ color: c.muted, marginTop: 4 }}>
                {missing.body}
              </Text>
            </Card>
          ) : null}

          {status?.balance_cents != null ? (
            <Card>
              <Text variant="titleMedium">Last known balance</Text>
              <Text variant="headlineSmall">{formatCents(status.balance_cents)}</Text>
              <Text variant="bodySmall" style={{ color: c.muted }}>
                {status.balance_date ? `as of ${formatDate(status.balance_date)}` : ""}
                {status.last_sync_at ? ` · synced ${new Date(status.last_sync_at * 1000).toLocaleString("de-DE")}` : ""}
              </Text>
            </Card>
          ) : null}

          <Card>
            <Text variant="titleMedium" accessibilityRole="header">Your Sparkasse account</Text>
            <View style={{ gap: 8, marginTop: 8 }}>
              <TextInput mode="outlined" label="Bank code (BLZ)" accessibilityLabel="Bank code (BLZ)" value={blz} onChangeText={setBlz} keyboardType="number-pad" error={!!blzProblem(blz)} />
              {blzProblem(blz) ? <FieldMessage tone="error">{blzProblem(blz) as string}</FieldMessage> : null}
              <TextInput mode="outlined" label="Online banking login" accessibilityLabel="Online banking login" value={userId} onChangeText={setUserId} autoCapitalize="none" autoCorrect={false} />
              <TextInput mode="outlined" label="IBAN" accessibilityLabel="IBAN" value={iban} onChangeText={setIban} autoCapitalize="characters" autoCorrect={false} error={!!ibanProblem(iban)} />
              {ibanProblem(iban) ? <FieldMessage tone="error">{ibanProblem(iban) as string}</FieldMessage> : null}
              <TextInput mode="outlined" label="PIN" accessibilityLabel="PIN" value={pin} onChangeText={setPin} secureTextEntry autoCapitalize="none" autoCorrect={false} />
            </View>
            <View style={{ marginTop: 12 }}>
              <SettingsGroup>
                <SettingsToggleRow icon="lock-outline" title="Remember the PIN on this device" subtitle="Kept in this device's secure storage, never on the server." value={rememberPin} onValueChange={setRememberPin} />
              </SettingsGroup>
            </View>
            <FieldMessage tone="info">
              The PIN goes to your server only for the sync and is never stored there. Only pushTAN (approval in the Sparkasse app) is supported.
            </FieldMessage>
            <View style={{ marginTop: 16 }}>
              <Button label={waiting ? "Waiting for approval…" : "Sync now"} icon="bank-transfer" onPress={start} disabled={waiting || !ready} />
            </View>
          </Card>

          {waiting ? (
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                <ActivityIndicator />
                <Text variant="bodyLarge" style={{ flex: 1 }}>
                  {phase.challenge || "Fetching…"}
                </Text>
              </View>
              <Text variant="bodySmall" style={{ color: c.muted, marginTop: 8 }}>
                Open your Sparkasse app and approve the request. This page checks every few seconds.
              </Text>
              <Button mode="text" label="Cancel" onPress={() => { cancelled.current = true; setPhase({ kind: "idle" }); }} />
            </Card>
          ) : null}
          {phase.kind === "done" ? <FieldMessage tone="ok">{phase.text}</FieldMessage> : null}
          {phase.kind === "error" ? <FieldMessage tone="error">{phase.text}</FieldMessage> : null}
        </ScrollView>
      )}
    </Screen>
  );
}
