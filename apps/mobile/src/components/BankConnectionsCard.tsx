import { Link, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking, Text as RNText, View } from "react-native";

import type { BankConnection } from "@/api/client";
import { useApi } from "@/api/config";
import {
  POLL_MS,
  anyBusy,
  approvalLeftText,
  canSync,
  connectionKey,
  connectionSubtitle,
  isBusy,
  isPlaid,
  isSafeLinkUrl,
  lastResultText,
  linkedAccountsText,
  needsLinking,
  needsTypedPin,
  nextSyncText,
  stateLabel,
  stateTone,
  syncButtonLabel,
} from "@/bankConnections";
import { ActivityIndicator, HelperText, Text, TextInput } from "@/components/kit";
import { Badge } from "@/components/Watchdog";
import { SettingsPanel } from "@/components/settings/SettingsKit";
import { Body, Button, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";

/**
 * Settings card: the bank connections that are set up in the server's financer.toml, from either
 * provider. Shows the state of each, starts a sync ("Sync now") and, while the bank waits for the
 * approval in the banking app (FinTS) or for you to sign in on Plaid's page (Plaid), says so. The
 * server polls by itself and imports as soon as you are done, so this screen does not have to stay
 * open. The old manual flow (Spending > Sync with Sparkasse) is
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
  const [confirming, setConfirming] = useState<string | null>(null);
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
      const updated = await api.syncConnection(conn.name, pins[key] || undefined);
      replace(updated);
      setPins((cur) => ({ ...cur, [key]: "" })); // the PIN is not kept
      // Plaid: its page is where you sign in to your bank; open it right away
      if (updated.state === "needs_link") await openLink(updated, key);
    } catch (e) {
      setError(key, e instanceof Error ? e.message : "Could not start the sync");
      await load();
    } finally {
      setStarting(null);
    }
  }

  async function openLink(conn: BankConnection, key: string) {
    if (!isSafeLinkUrl(conn.link_url)) {
      setError(key, "The sign-in address from the server does not look like a Plaid page, so it was not opened.");
      return;
    }
    try {
      await Linking.openURL(conn.link_url);
    } catch {
      setError(key, "Could not open the browser. Copy the address from the server log, or try again.");
    }
  }

  /** A second press confirms (an inline question works on the web build too, where Alert does nothing). */
  function disconnect(conn: BankConnection) {
    if (!api) return;
    const key = connectionKey(conn);
    setConfirming(null);
    setError(key, null);
    api
      .disconnectConnection(conn.name)
      .then(replace)
      .catch(async (e: unknown) => {
        setError(key, e instanceof Error ? e.message : "Could not disconnect");
        await load();
      });
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
            These connections are set up under Server settings, Bank accounts (or in financer.toml on the server). A bank (FinTS) connection never
            stores your PIN: it comes from the server's environment or you type it here, and every login needs your approval in
            the banking app. A Plaid connection needs neither: you sign in to your bank once on Plaid's page.
          </Text>
          {list.map((conn) => {
            const key = connectionKey(conn);
            const pin = pins[key] ?? "";
            const waiting = conn.state === "needs_approval";
            const signingIn = conn.state === "needs_link";
            const accounts = linkedAccountsText(conn);
            const last = lastResultText(conn);
            const next = nextSyncText(conn, now);
            const left = approvalLeftText(conn, now);
            return (
              <View key={key} style={{ marginTop: 16, borderTopWidth: 2, borderTopColor: c.border, paddingTop: 12 }}>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                  <View style={{ flex: 1 }}>
                    <Body bold>{conn.name}</Body>
                    <RNText style={{ color: c.muted, fontSize: 13 }}>{connectionSubtitle(conn)}</RNText>
                  </View>
                  <Badge text={stateLabel(conn)} tone={stateTone(conn)} />
                </View>

                {waiting ? (
                  <View
                    accessibilityLiveRegion="polite"
                    style={{ marginTop: 10, padding: 12, borderRadius: 16, borderWidth: 1, borderColor: c.accent }}
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
                {signingIn ? (
                  <View
                    accessibilityLiveRegion="polite"
                    style={{ marginTop: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: c.accent }}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                      <ActivityIndicator />
                      <RNText style={{ color: c.text, fontSize: 15, fontWeight: "700", flex: 1 }}>
                        Sign in to your bank on Plaid's page
                      </RNText>
                    </View>
                    <RNText style={{ color: c.text, marginTop: 6 }}>
                      Your bank login goes to Plaid, not to this app. When you are done, this screen updates and the first
                      sync starts by itself. {left ?? ""}
                    </RNText>
                    <Button label="Open the sign-in page" icon="open-in-new" mode="outlined" onPress={() => void openLink(conn, key)} />
                    <Button mode="text" label="Cancel" onPress={() => void cancel(conn)} />
                  </View>
                ) : null}
                {conn.state === "syncing" ? (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 10 }}>
                    <ActivityIndicator />
                    <RNText style={{ color: c.text, flex: 1 }}>
                      {isPlaid(conn) ? "Reading transactions from Plaid…" : "Logging in or fetching transactions…"}
                    </RNText>
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
                {accounts ? <RNText style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>Accounts: {accounts}</RNText> : null}
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
                      label={syncButtonLabel(conn, starting === key)}
                      icon={needsLinking(conn) ? "link-variant" : "bank-transfer"}
                      onPress={() => void sync(conn)}
                      disabled={starting !== null || !canSync(conn, pin)}
                    />
                    {isPlaid(conn) && conn.linked && confirming !== key ? (
                      <Button mode="text" label="Disconnect" icon="link-variant-off" onPress={() => setConfirming(key)} />
                    ) : null}
                    {confirming === key ? (
                      <View accessibilityLiveRegion="polite" style={{ marginTop: 8 }}>
                        <RNText style={{ color: c.text }}>
                          Plaid is told to forget this connection and its access is deleted here. The transactions you already have
                          stay. You sign in again to reconnect.
                        </RNText>
                        <Button label="Disconnect" icon="link-variant-off" mode="outlined" onPress={() => disconnect(conn)} />
                        <Button mode="text" label="Keep it" onPress={() => setConfirming(null)} />
                      </View>
                    ) : null}
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
