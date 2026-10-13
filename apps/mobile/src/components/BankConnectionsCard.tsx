import { Link, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Text as RNText, View } from "react-native";

import type { BankConnection } from "@/api/client";
import { useApi } from "@/api/config";
import {
  POLL_MS,
  anyBusy,
  approvalLeftText,
  canSync,
  connectionKey,
  isBusy,
  lastResultText,
  needsTypedPin,
  nextSyncText,
  stateLabel,
  stateTone,
} from "@/bankConnections";
import { ActivityIndicator, HelperText, Text, TextInput } from "@/components/kit";
import { Badge } from "@/components/Watchdog";
import { SettingsPanel } from "@/components/settings/SettingsKit";
import { Body, Button, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";

/**
 * Settings card: the bank connections that are set up in the server's financer.toml. Shows the
 * state of each, starts a sync ("Sync now") and, while the bank waits for the approval in the
 * banking app, says so. The server polls the bank itself and imports as soon as you approve, so
 * this screen does not have to stay open. The old manual flow (Spending > Sync with Sparkasse) is
 * offered here only when no connection is configured.
 */
export function BankConnectionsCard() {
  const { api, mode } = useApi();
  const c = useColors();
  const [list, setList] = useState<BankConnection[] | null>(null);
  const [unreadable, setUnreadable] = useState(false);
  const [pins, setPins] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [starting, setStarting] = useState<string | null>(null);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  const load = useCallback(async () => {
    if (!api) return;
    try {
      setList(await api.bankConnections());
      setUnreadable(false);
    } catch {
      // an older server has no such endpoint; the manual flow is still there
      setList([]);
      setUnreadable(true);
    }
    setNow(Math.floor(Date.now() / 1000));
  }, [api]);

  const busy = list ? anyBusy(list) : false;
  useFocusEffect(
    useCallback(() => {
      void load();
      if (!busy) return;
      const timer = setInterval(() => void load(), POLL_MS);
      return () => clearInterval(timer);
    }, [load, busy]),
  );
  // keep "time left" fresh between polls
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 15_000);
    return () => clearInterval(timer);
  }, [busy]);

  if (!api || list === null) return null;

  const replace = (updated: BankConnection) =>
    setList((cur) => (cur ?? []).map((x) => (connectionKey(x) === connectionKey(updated) ? updated : x)));
  const setError = (key: string, message: string | null) =>
    setErrors((cur) => {
      const next = { ...cur };
      if (message) next[key] = message;
      else delete next[key];
      return next;
    });

  async function sync(conn: BankConnection) {
    if (!api) return;
    const key = connectionKey(conn);
    setError(key, null);
    setStarting(key);
    try {
      replace(await api.syncConnection(conn.name, pins[key] || undefined));
      setPins((cur) => ({ ...cur, [key]: "" })); // the PIN is not kept
    } catch (e) {
      setError(key, e instanceof Error ? e.message : "Could not start the sync");
      await load();
    } finally {
      setStarting(null);
    }
  }

  async function cancel(conn: BankConnection) {
    if (!api) return;
    const key = connectionKey(conn);
    setError(key, null);
    try {
      replace(await api.cancelConnection(conn.name));
    } catch (e) {
      setError(key, e instanceof Error ? e.message : "Could not cancel");
      await load();
    }
  }

  const embedded = mode === "embedded";
  // One line for the closed row; open by default only when something needs the user's attention.
  const attention = list.find((conn) => conn.state === "needs_approval" || conn.state === "syncing" || conn.state === "error");
  const first = attention ?? list[0];
  const summary =
    list.length === 0
      ? "Not set up in financer.toml"
      : list.length === 1
        ? `${first.name} · ${stateLabel(first)}`
        : `${list.length} accounts${attention ? ` · ${attention.name}: ${stateLabel(attention)}` : ""}`;
  return (
    <SettingsPanel icon="bank-transfer" title="Bank connections" summary={summary} defaultOpen={attention !== undefined}>
      {list.length === 0 ? (
        <>
          <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
            {embedded
              ? "The on-phone backend does not read a financer.toml, so no connection can be set up here."
              : unreadable
                ? "Could not read the connections from the server (an older server?)."
                : "No bank connection is set up in financer.toml on your server."}{" "}
            With one, the server can sync by itself on a schedule and you only approve in your banking app. See docs/CONFIG.md.
          </Text>
          <Text variant="bodySmall" style={{ color: c.muted, marginTop: 8 }}>
            You can still sync by hand, entering your bank details each time:
          </Text>
          <Link href="/sync" asChild>
            <Button label="Sync with Sparkasse" icon="bank-transfer" mode="outlined" onPress={() => {}} />
          </Link>
        </>
      ) : (
        <>
          <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
            These connections are configured in financer.toml on the server; change them there. Your PIN is never stored: it
            comes from the server's environment or you type it here. Every login still needs your approval in the banking app.
          </Text>
          {list.map((conn) => {
            const key = connectionKey(conn);
            const pin = pins[key] ?? "";
            const waiting = conn.state === "needs_approval";
            const last = lastResultText(conn);
            const next = nextSyncText(conn, now);
            const left = approvalLeftText(conn, now);
            return (
              <View key={key} style={{ marginTop: 16, borderTopWidth: 2, borderTopColor: c.border, paddingTop: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Body bold>{conn.name}</Body>
                    <RNText style={{ color: c.muted, fontSize: 13 }}>
                      Bank code {conn.bank_code} · login {conn.login_masked} · {conn.iban_masked}
                    </RNText>
                  </View>
                  <Badge text={stateLabel(conn)} tone={stateTone(conn)} />
                </View>

                {waiting ? (
                  <View
                    accessibilityLiveRegion="polite"
                    style={{ marginTop: 10, padding: 12, borderRadius: 16, borderWidth: 2, borderColor: c.accent }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <ActivityIndicator />
                      <RNText style={{ color: c.text, fontSize: 15, fontWeight: "700", flex: 1 }}>
                        Approve the login in your banking app
                      </RNText>
                    </View>
                    {conn.message ? <RNText style={{ color: c.text, marginTop: 6 }}>{conn.message}</RNText> : null}
                    <RNText style={{ color: c.muted, fontSize: 13, marginTop: 6 }}>
                      You can close this screen: the server imports as soon as you approve. {left ?? ""}
                    </RNText>
                    <Button mode="text" label="Cancel" onPress={() => void cancel(conn)} />
                  </View>
                ) : null}
                {conn.state === "syncing" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 }}>
                    <ActivityIndicator />
                    <RNText style={{ color: c.text, flex: 1 }}>Logging in or fetching transactions…</RNText>
                  </View>
                ) : null}
                {conn.state === "error" && conn.message ? <HelperText type="error" visible>{conn.message}</HelperText> : null}
                {errors[key] ? <HelperText type="error" visible>{errors[key]}</HelperText> : null}

                {conn.balance_cents != null ? (
                  <RNText style={{ color: c.muted, fontSize: 13, marginTop: 6 }}>
                    Balance {formatCents(conn.balance_cents)}
                    {conn.balance_date ? ` (${formatDate(conn.balance_date)})` : ""}
                  </RNText>
                ) : null}
                {last ? <RNText style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>{last}</RNText> : null}
                {next ? <RNText style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>{next}</RNText> : null}

                {!isBusy(conn) ? (
                  <View style={{ marginTop: 10 }}>
                    {needsTypedPin(conn) ? (
                      <TextInput
                        mode="outlined"
                        label="PIN (used for this sync only)"
                        accessibilityLabel={`PIN for ${conn.name}`}
                        value={pin}
                        onChangeText={(v) => setPins((cur) => ({ ...cur, [key]: v }))}
                        secureTextEntry
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={{ marginBottom: 8 }}
                      />
                    ) : null}
                    <Button
                      label={starting === key ? "Starting…" : "Sync now"}
                      icon="bank-transfer"
                      onPress={() => void sync(conn)}
                      disabled={starting !== null || !canSync(conn, pin)}
                    />
                  </View>
                ) : null}
              </View>
            );
          })}
        </>
      )}
    </SettingsPanel>
  );
}
