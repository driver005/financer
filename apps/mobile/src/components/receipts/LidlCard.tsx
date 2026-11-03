import { useState } from "react";
import { Platform } from "react-native";
import { Badge, Box, Button, Card, ConfirmAction, Expandable, Group, Icon, IconBadge, ListItem, Note, Row, Text, TextField } from "@financer/ui";

import type { Api, LidlStart, LidlStatus, ReceiptSource } from "@/api/client";
import { useApi } from "@/api/config";
import { openInBrowser, openSignInPage } from "@/native/authSession";
import { celebrate } from "@/native/haptics";
import {
  callbackHasResult,
  disconnectedText,
  extractCallbackUrl,
  healthPill,
  importedText,
  lastSyncText,
  lidlPromises,
  lidlStateText,
  setupSteps,
  signInMode,
  syncResultText,
} from "@/receiptSources";
import { asIcon, toTone } from "@/uiTone";

type Message = { tone: "error" | "ok" | "info"; text: string } | null;

/**
 * The Lidl Plus card: what signing in means, the sign-in itself (in a browser sheet on a phone,
 * by pasting the address on the web), and the connection once it exists. The password is only
 * ever typed on Lidl's own page.
 */
export function LidlCard({
  api,
  source,
  status,
  onChanged,
}: {
  api: Api;
  source: ReceiptSource;
  status: LidlStatus | null;
  onChanged: () => Promise<void> | void;
}) {
  const { mode: backendMode, embedded, saveEmbedded } = useApi();
  // On the phone's own backend there is no server and no financer.toml: Lidl Plus is a switch here.
  const onPhone = backendMode === "embedded";
  const now = Math.floor(Date.now() / 1000);
  const mode = signInMode(Platform.OS);
  const pill = healthPill(source);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState<LidlStart | null>(null);
  const [pasted, setPasted] = useState("");

  const state = status?.state ?? "disabled";
  const switchedOff = state === "disabled";
  const connected = state === "connected";

  async function finish(start: LidlStart, url: string) {
    const result = await api.lidlFinish(start.state, url);
    setPending(null);
    setPasted("");
    celebrate();
    setMessage({
      tone: "ok",
      text: result.receipts === 0 ? "Connected. No receipts found yet." : `Connected. ${importedText(result.receipts)}.`,
    });
    await onChanged();
  }

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const start = await api.lidlStart();
      if (mode === "auth-session") {
        const res = await openSignInPage(start.authorization_url, start.redirect_uri);
        if (res.kind === "callback") {
          await finish(start, res.url);
        } else {
          setMessage({ tone: "info", text: "Sign-in was closed before it finished. Nothing was saved." });
        }
      } else {
        // the page is opened from the next button, which is a tap and therefore allowed to open it
        setPending(start);
      }
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not start the sign-in" });
    } finally {
      setBusy(false);
    }
  }

  async function finishPasted() {
    if (!pending) return;
    const url = extractCallbackUrl(pasted, pending.callback_scheme);
    if (!url || !callbackHasResult(url)) {
      setMessage({ tone: "error", text: `That does not look like the address. It starts with ${pending.callback_scheme}://callback?code=` });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      await finish(pending, url);
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not finish the sign-in" });
    } finally {
      setBusy(false);
    }
  }

  async function syncNow() {
    setBusy(true);
    setMessage(null);
    try {
      const r = await api.syncReceipts("lidl_plus");
      setMessage({ tone: "info", text: syncResultText(r.imported, r.linked) });
      await onChanged();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Sync failed" });
    } finally {
      setBusy(false);
    }
  }

  async function switchPhone(on: boolean) {
    setBusy(true);
    setMessage(null);
    try {
      await saveEmbedded({ ...embedded, lidlPlus: on }); // restarts the on-phone backend
      setMessage({ tone: "info", text: on ? "Lidl Plus is switched on." : "Lidl Plus is switched off. A saved sign-in stays until you disconnect." });
      await onChanged();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not change the setting" });
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    setBusy(true);
    setMessage(null);
    try {
      await api.lidlDisconnect();
      setMessage({ tone: "info", text: disconnectedText(onPhone) });
      await onChanged();
    } catch (e) {
      setMessage({ tone: "error", text: e instanceof Error ? e.message : "Could not disconnect" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card gap="md">
      <Row gap="md">
        <IconBadge icon="cart-heart" tone="info" />
        <Box grow gap="xs">
          <Text variant="heading" level={2}>Lidl Plus</Text>
          <Text variant="caption" tone="muted">Experimental and unofficial</Text>
          <Row>
            <Badge label={pill.label} tone={toTone(pill.tone)} icon={asIcon(pill.icon)} />
          </Row>
        </Box>
      </Row>

      <Text variant="body">{lidlStateText(state, status?.connected_at, now, onPhone)}</Text>

      {switchedOff ? (
        <Box gap="sm">
          {setupSteps("lidl_plus", onPhone).map((s, i) => (
            <Text key={i} variant="label" tone="muted">{`${i + 1}. ${s}`}</Text>
          ))}
          {onPhone ? <Button label={busy ? "Switching on…" : "Switch on Lidl Plus"} icon="power" onPress={() => void switchPhone(true)} disabled={busy} /> : null}
        </Box>
      ) : (
        <>
          <Box gap="sm">
            {lidlPromises(onPhone).map((t) => (
              <Row key={t} gap="sm" align="start">
                <Icon name={t.startsWith("This is unofficial") ? "alert-outline" : "check-circle-outline"} size="sm" tone="muted" />
                <Box grow><Text variant="label">{t}</Text></Box>
              </Row>
            ))}
          </Box>

          {connected ? (
            <Group>
              <ListItem title="Last sync" value={lastSyncText(status?.last_sync, now)} />
              <ListItem title="Receipts from Lidl Plus" value={String(status?.receipts ?? 0)} />
            </Group>
          ) : null}
          {status?.last_error ? <Note tone="error">{status.last_error}</Note> : null}

          {pending ? (
            <Box gap="sm">
              <Text variant="bodyStrong">Sign in on Lidl's page</Text>
              <Text variant="label" tone="muted">
                {"1. Open Lidl's sign-in page and sign in there.\n2. At the end the browser may show an error or a blank page. That is expected, because the address it goes to starts with "}
                {`${pending.callback_scheme}://`}
                {" and only the Lidl app understands it.\n3. Copy that address from the address bar and paste it below. Some browsers do not show it; then open the developer tools (Network tab) and copy the request that ends in callback?code=…, or use the email route instead."}
              </Text>
              <Button label="Open Lidl's sign-in page" icon="open-in-new" onPress={() => void openInBrowser(pending.authorization_url)} />
              <TextField label="Address you ended up on" value={pasted} onChangeText={setPasted} multiline />
              <Button label={busy ? "Finishing…" : "Finish connecting"} icon="link-variant" onPress={() => void finishPasted()} disabled={busy || !pasted.trim()} />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => {
                  setPending(null);
                  setPasted("");
                  setMessage(null);
                }}
              />
            </Box>
          ) : (
            <Box gap="sm">
              {connected ? (
                <>
                  <Button label={busy ? "Syncing…" : "Sync Lidl Plus now"} icon="sync" onPress={() => void syncNow()} disabled={busy} />
                  <ConfirmAction
                    label="Disconnect"
                    icon="link-off"
                    question="Disconnect Lidl Plus?"
                    consequence={`The saved sign-in is deleted from ${onPhone ? "this phone" : "your server"}. Receipts you already imported stay. You can connect again any time.`}
                    confirmLabel="Disconnect"
                    onConfirm={() => void disconnect()}
                    disabled={busy}
                  />
                </>
              ) : (
                <Button label={busy ? "Opening…" : state === "needs_signin" ? "Sign in again" : "Connect Lidl Plus"} icon="login" onPress={() => void connect()} disabled={busy} />
              )}
            </Box>
          )}

          {message ? <Note tone={message.tone}>{message.text}</Note> : null}

          {onPhone ? (
            <ConfirmAction
              label="Switch off Lidl Plus"
              icon="power"
              question="Switch off Lidl Plus?"
              consequence="Receipts stop being imported. A saved sign-in stays on this phone until you disconnect it."
              confirmLabel="Switch off"
              onConfirm={() => void switchPhone(false)}
              disabled={busy}
            />
          ) : null}

          <Expandable icon="help-circle-outline" title="How this works">
            <Text variant="caption" tone="muted">
              Lidl has no public interface for third parties. Financer uses the same sign-in the Lidl Plus app uses (an OpenID Connect sign-in with PKCE) and then reads your receipts with a long-lived token. The method was worked out by the open-source Lidl Plus client by Andre0512; Financer reimplements it and does not copy its code.
            </Text>
            <Text variant="caption" tone="muted">
              {Platform.OS === "android"
                ? "On Android the sign-in returns to Financer through the address com.lidlplus.app://. If the Lidl app is installed, Android may offer to open that instead; choose Financer."
                : "If this does not work for you, the email route above is the reliable one: REWE and many other shops mail you the receipt."}
            </Text>
          </Expandable>
        </>
      )}
    </Card>
  );
}
