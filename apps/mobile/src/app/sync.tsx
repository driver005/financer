import { useCallback, useEffect, useRef, useState } from "react";
import { ScrollView, View } from "react-native";
import { ActivityIndicator, HelperText, Switch, Text, TextInput } from "react-native-paper";

import { ApiError } from "@/api/client";
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
  const { api, loaded } = useApi();
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
              <Body bold>Live sync is not set up on the server</Body>
              <Text variant="bodyMedium" style={{ color: c.muted, marginTop: 4 }}>
                It needs a FinTS product id (FINANCER_FINTS_PRODUCT_ID), which you request from the Deutsche
                Kreditwirtschaft. See docs/FINTS.md. Until then, import a CSV export on the Spending tab.
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
            <TextInput mode="outlined" label="Bank code (BLZ)" accessibilityLabel="Bank code (BLZ)" value={blz} onChangeText={setBlz} keyboardType="number-pad" />
            <TextInput mode="outlined" label="Online banking login" accessibilityLabel="Online banking login" value={userId} onChangeText={setUserId} autoCapitalize="none" autoCorrect={false} style={{ marginTop: 8 }} />
            <TextInput mode="outlined" label="IBAN" accessibilityLabel="IBAN" value={iban} onChangeText={setIban} autoCapitalize="characters" autoCorrect={false} style={{ marginTop: 8 }} />
            <TextInput mode="outlined" label="PIN" accessibilityLabel="PIN" value={pin} onChangeText={setPin} secureTextEntry autoCapitalize="none" autoCorrect={false} style={{ marginTop: 8 }} />
            <View style={{ flexDirection: "row", alignItems: "center", marginTop: 8 }}>
              <Switch value={rememberPin} onValueChange={setRememberPin} accessibilityLabel="Remember the PIN on this device" />
              <Text variant="bodyMedium" style={{ marginLeft: 12, flex: 1 }}>Remember the PIN on this device</Text>
            </View>
            <HelperText type="info" visible>
              The PIN goes to your server only for the sync and is never stored there. Only pushTAN (approval in the
              Sparkasse app) is supported.
            </HelperText>
            <Button label={waiting ? "Waiting for approval…" : "Sync now"} icon="bank-transfer" onPress={start} disabled={waiting || !ready} />
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
          {phase.kind === "done" ? <HelperText type="info" visible>{phase.text}</HelperText> : null}
          {phase.kind === "error" ? <HelperText type="error" visible>{phase.text}</HelperText> : null}
        </ScrollView>
      )}
    </Screen>
  );
}
