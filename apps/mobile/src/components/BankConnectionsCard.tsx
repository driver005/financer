import { Link, useFocusEffect } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Linking } from "react-native";
import { Badge, Box, Button, Card, Divider, Expandable, Note, Row, Spinner, Text, TextField } from "@financer/ui";

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
  linksOnce,
  providerLabel,
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
import { formatCents, formatDate } from "@/format";
import { toTone } from "@/uiTone";

/**
 * Settings card: the bank connections that are set up in the server's financer.toml, from either
 * provider. Shows the state of each, starts a sync ("Sync now") and, while the bank waits for the
 * approval in the banking app (FinTS) or for you to sign in on the provider's page (Plaid, GoCardless, finAPI), says so. The
 * server polls by itself and imports as soon as you are done, so this screen does not have to stay
 * open. The old manual flow (Spending > Sync with Sparkasse) is
 * offered here only when no connection is configured.
 */
export function BankConnectionsCard() {
  const { api, mode } = useApi();
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
      // Plaid, GoCardless, finAPI: their page is where you sign in to your bank; open it right away
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
      setError(key, "The sign-in address from the server does not look like a page of Plaid, GoCardless or finAPI, so it was not opened.");
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
    <Expandable icon="bank-transfer" title="Bank connections" summary={summary} defaultOpen={attention !== undefined}>
      {list.length === 0 ? (
        <>
          <Text variant="caption" tone="muted">
            {embedded
              ? "The on-phone backend does not read a financer.toml, so no connection can be set up here."
              : unreadable
                ? "Could not read the connections from the server (an older server?)."
                : "No bank connection is set up in financer.toml on your server."}{" "}
            With one, the server can sync by itself on a schedule and you only approve in your banking app. See docs/CONFIG.md.
          </Text>
          <Text variant="caption" tone="muted">You can still sync by hand, entering your bank details each time:</Text>
          <Link href="/sync" asChild>
            <Button label="Sync with Sparkasse" icon="bank-transfer" variant="outline" onPress={() => {}} />
          </Link>
        </>
      ) : (
        <>
          <Text variant="caption" tone="muted">
            These connections are set up under Server settings, Bank accounts (or in financer.toml on the server). A bank (FinTS) connection never stores your PIN: it comes from the server's environment or you type it here, and every login needs your approval in the banking app. A Plaid, GoCardless or finAPI connection needs neither: you sign in to your bank once on the provider's page.
          </Text>
          {list.map((conn, index) => {
            const key = connectionKey(conn);
            const pin = pins[key] ?? "";
            const waiting = conn.state === "needs_approval";
            const signingIn = conn.state === "needs_link";
            const accounts = linkedAccountsText(conn);
            const last = lastResultText(conn);
            const next = nextSyncText(conn, now);
            const left = approvalLeftText(conn, now);
            return (
              <Box key={key} gap="sm">
                {index > 0 ? <Divider /> : null}
                <Row justify="between" gap="sm">
                  <Box grow>
                    <Text variant="bodyStrong">{conn.name}</Text>
                    <Text variant="caption" tone="muted">{connectionSubtitle(conn)}</Text>
                  </Box>
                  <Badge label={stateLabel(conn)} tone={toTone(stateTone(conn))} />
                </Row>

                {waiting ? (
                  <Card variant="outline" gap="sm">
                    <Box accessibilityRole="alert" gap="sm">
                      <Row gap="md">
                        <Spinner />
                        <Box grow><Text variant="bodyStrong">Approve the login in your banking app</Text></Box>
                      </Row>
                      {conn.message ? <Text variant="body">{conn.message}</Text> : null}
                      <Text variant="caption" tone="muted">{`You can close this screen: the server imports as soon as you approve. ${left ?? ""}`}</Text>
                    </Box>
                    <Button variant="ghost" label="Cancel" onPress={() => void cancel(conn)} />
                  </Card>
                ) : null}
                {signingIn ? (
                  <Card variant="outline" gap="sm">
                    <Box accessibilityRole="alert" gap="sm">
                      <Row gap="md">
                        <Spinner />
                        <Box grow><Text variant="bodyStrong">{`Sign in to your bank on ${providerLabel(conn)}'s page`}</Text></Box>
                      </Row>
                      <Text variant="body">{`Your bank login goes to ${providerLabel(conn)}, not to this app. When you are done, this screen updates and the first sync starts by itself. ${left ?? ""}`}</Text>
                    </Box>
                    <Button label="Open the sign-in page" icon="open-in-new" variant="outline" onPress={() => void openLink(conn, key)} />
                    <Button variant="ghost" label="Cancel" onPress={() => void cancel(conn)} />
                  </Card>
                ) : null}
                {conn.state === "syncing" ? (
                  <Row gap="md">
                    <Spinner />
                    <Box grow><Text variant="body">{linksOnce(conn) ? `Reading transactions from ${providerLabel(conn)}…` : "Logging in or fetching transactions…"}</Text></Box>
                  </Row>
                ) : null}
                {conn.state === "error" && conn.message ? <Note tone="error">{conn.message}</Note> : null}
                {errors[key] ? <Note tone="error">{errors[key]}</Note> : null}

                {conn.balance_cents != null ? (
                  <Text variant="caption" tone="muted">{`Balance ${formatCents(conn.balance_cents)}${conn.balance_date ? ` (${formatDate(conn.balance_date)})` : ""}`}</Text>
                ) : null}
                {accounts ? <Text variant="caption" tone="muted">{`Accounts: ${accounts}`}</Text> : null}
                {last ? <Text variant="caption" tone="muted">{last}</Text> : null}
                {next ? <Text variant="caption" tone="muted">{next}</Text> : null}

                {!isBusy(conn) ? (
                  <Box gap="sm">
                    {needsTypedPin(conn) ? <TextField label="PIN (used for this sync only)" value={pin} onChangeText={(v) => setPins((cur) => ({ ...cur, [key]: v }))} secure /> : null}
                    <Button
                      label={syncButtonLabel(conn, starting === key)}
                      icon={needsLinking(conn) ? "link-variant" : "bank-transfer"}
                      onPress={() => void sync(conn)}
                      disabled={starting !== null || !canSync(conn, pin)}
                    />
                    {linksOnce(conn) && conn.linked && confirming !== key ? <Button variant="ghost" label="Disconnect" icon="link-variant-off" onPress={() => setConfirming(key)} /> : null}
                    {confirming === key ? (
                      <Box gap="sm" accessibilityRole="alert">
                        <Text variant="body">{`${providerLabel(conn)} is told to forget this connection and its access is deleted here. The transactions you already have stay. You sign in again to reconnect.`}</Text>
                        <Button label="Disconnect" icon="link-variant-off" variant="outline" tone="danger" onPress={() => disconnect(conn)} />
                        <Button variant="ghost" label="Keep it" onPress={() => setConfirming(null)} />
                      </Box>
                    ) : null}
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </>
      )}
    </Expandable>
  );
}
