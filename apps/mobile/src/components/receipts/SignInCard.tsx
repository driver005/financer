import { useState } from "react";
import { Platform } from "react-native";
import { Badge, Box, Button, Card, ConfirmAction, Expandable, Group, Icon, IconBadge, ListItem, Note, Row, Text, TextField } from "@financer/ui";

import type { Api, ReceiptSource, SourceConnect } from "@/api/client";
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
  setupSteps,
  signInMode,
  signInPromises,
  isSignedIn,
  signInStateText,
  sourceIcon,
  syncResultText,
  type SignInShop,
} from "@/receiptSources";
import { asIcon, toTone } from "@/uiTone";

type Message = { tone: "error" | "ok" | "info"; text: string } | null;

type BrandKey = "lidl_plus" | "kaufland_card";

/** What differs between the shops that are signed in to on their own page. */
type Brand = {
  source: BrandKey;
  shop: SignInShop;
  name: string;
  tone: "info" | "success";
  start: (api: Api) => Promise<SourceConnect>;
  finish: (api: Api, state: string, url: string) => Promise<ReceiptSource>;
  disconnect: (api: Api) => Promise<ReceiptSource>;
  /** The switch of the on-phone backend. */
  phoneKey: "lidlPlus" | "kaufland";
  howItWorks: string;
  androidNote: string;
};

const BRANDS: Record<BrandKey, Brand> = {
  lidl_plus: {
    source: "lidl_plus",
    shop: "Lidl",
    name: "Lidl Plus",
    tone: "info",
    start: (a) => a.connectSource("lidl_plus"),
    finish: (a, s, u) => a.finishSource("lidl_plus", s, u),
    disconnect: (a) => a.disconnectSource("lidl_plus"),
    phoneKey: "lidlPlus",
    howItWorks:
      "Lidl has no public interface for third parties. Financer uses the same sign-in the Lidl Plus app uses (an OpenID Connect sign-in with PKCE) and then reads your receipts with a long-lived token. The method was worked out by the open-source Lidl Plus client by Andre0512; Financer reimplements it and does not copy its code.",
    androidNote: "On Android the sign-in returns to Financer through the address com.lidlplus.app://. If the Lidl app is installed, Android may offer to open that instead; choose Financer.",
  },
  kaufland_card: {
    source: "kaufland_card",
    shop: "Kaufland",
    name: "Kaufland Card",
    tone: "success",
    start: (a) => a.connectSource("kaufland_card"),
    finish: (a, s, u) => a.finishSource("kaufland_card", s, u),
    disconnect: (a) => a.disconnectSource("kaufland_card"),
    phoneKey: "kaufland",
    howItWorks:
      "Kaufland has no public interface for third parties. Financer signs in the way the Kaufland app does (an OAuth sign-in with PKCE on Kaufland's own account page) and then reads your digital receipts with a long-lived token. The method was worked out by the open-source project Bonfire; Financer reimplements it and does not copy its code. Only receipts you chose to get digitally (\"Papierbon sparen\" in the Kaufland app) exist.",
    androidNote: "On Android the sign-in returns to Financer through the address com.kaufland.kaufland://. If the Kaufland app is installed, Android may offer to open that instead; choose Financer.",
  },
};

/**
 * The card of a shop that is signed in to on its own page (Lidl Plus, Kaufland Card): what signing
 * in means, the sign-in itself (in a browser sheet on a phone, by pasting the address on the web),
 * and the connection once it exists. The password is only ever typed on the shop's own page.
 */
export function SignInCard({
  brand: brandKey,
  api,
  source,
  status,
  onChanged,
}: {
  brand: BrandKey;
  api: Api;
  source: ReceiptSource;
  status: ReceiptSource | null;
  onChanged: () => Promise<void> | void;
}) {
  const brand = BRANDS[brandKey];
  const { mode: backendMode, embedded, saveEmbedded } = useApi();
  // On the phone's own backend there is no server and no financer.toml: each shop is a switch here.
  const onPhone = backendMode === "embedded";
  const now = Math.floor(Date.now() / 1000);
  const mode = signInMode(Platform.OS);
  const pill = healthPill(source);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [pending, setPending] = useState<SourceConnect | null>(null);
  const [pasted, setPasted] = useState("");

  const state = status?.state ?? "disabled";
  const switchedOff = state === "disabled";
  const connected = isSignedIn(state);

  async function finish(start: SourceConnect, url: string) {
    const result = await brand.finish(api, start.state, url);
    setPending(null);
    setPasted("");
    celebrate();
    setMessage({
      tone: "ok",
      text: result.imported_total === 0 ? "Connected. No receipts found yet." : `Connected. ${importedText(result.imported_total)}.`,
    });
    await onChanged();
  }

  async function connect() {
    setBusy(true);
    setMessage(null);
    try {
      const start = await brand.start(api);
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
      const r = await api.syncReceipts(brand.source);
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
      await saveEmbedded({ ...embedded, [brand.phoneKey]: on }); // restarts the on-phone backend
      setMessage({ tone: "info", text: on ? `${brand.name} is switched on.` : `${brand.name} is switched off. A saved sign-in stays until you disconnect.` });
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
      await brand.disconnect(api);
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
        <IconBadge icon={asIcon(sourceIcon(brand.source))} tone={brand.tone} />
        <Box grow gap="xs">
          <Text variant="heading" level={2}>{brand.name}</Text>
          <Text variant="caption" tone="muted">Experimental and unofficial</Text>
          <Row>
            <Badge label={pill.label} tone={toTone(pill.tone)} icon={asIcon(pill.icon)} />
          </Row>
        </Box>
      </Row>

      <Text variant="body">{signInStateText(brand.shop, state, status?.connected_at, now, onPhone)}</Text>

      {switchedOff ? (
        <Box gap="sm">
          {setupSteps(brand.source, onPhone).map((s, i) => (
            <Text key={i} variant="label" tone="muted">{`${i + 1}. ${s}`}</Text>
          ))}
          {onPhone ? <Button label={busy ? "Switching on…" : `Switch on ${brand.name}`} icon="power" onPress={() => void switchPhone(true)} disabled={busy} /> : null}
        </Box>
      ) : (
        <>
          <Box gap="sm">
            {signInPromises(brand.shop, onPhone).map((t) => (
              <Row key={t} gap="sm" align="start">
                <Icon name={t.startsWith("This is unofficial") ? "alert-outline" : "check-circle-outline"} size="sm" tone="muted" />
                <Box grow><Text variant="label">{t}</Text></Box>
              </Row>
            ))}
          </Box>

          {connected ? (
            <Group>
              <ListItem title="Last sync" value={lastSyncText(status?.last_run, now)} />
              <ListItem title={`Receipts from ${brand.name}`} value={String(status?.imported_total ?? 0)} />
            </Group>
          ) : null}
          {status?.last_error ? <Note tone="error">{status.last_error}</Note> : null}

          {pending ? (
            <Box gap="sm">
              <Text variant="bodyStrong">{`Sign in on ${brand.shop}'s page`}</Text>
              <Text variant="label" tone="muted">
                {`1. Open ${brand.shop}'s sign-in page and sign in there.\n2. At the end the browser may show an error or a blank page. That is expected, because the address it goes to starts with `}
                {`${pending.callback_scheme}://`}
                {` and only the ${brand.shop} app understands it.\n3. Copy that address from the address bar and paste it below. Some browsers do not show it; then open the developer tools (Network tab) and copy the request that ends in callback?code=…, or use the email route instead.`}
              </Text>
              <Button label={`Open ${brand.shop}'s sign-in page`} icon="open-in-new" onPress={() => void openInBrowser(pending.authorization_url)} />
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
                  <Button label={busy ? "Syncing…" : "Sync now"} icon="sync" onPress={() => void syncNow()} disabled={busy} />
                  <ConfirmAction
                    label="Disconnect"
                    icon="link-off"
                    question={`Disconnect ${brand.name}?`}
                    consequence={`The saved sign-in is deleted from ${onPhone ? "this phone" : "your server"}. Receipts you already imported stay. You can connect again any time.`}
                    confirmLabel="Disconnect"
                    onConfirm={() => void disconnect()}
                    disabled={busy}
                  />
                </>
              ) : (
                <Button label={busy ? "Opening…" : state === "needs_signin" ? "Sign in again" : "Connect"} icon="login" onPress={() => void connect()} disabled={busy} />
              )}
            </Box>
          )}

          {message ? <Note tone={message.tone}>{message.text}</Note> : null}

          {onPhone ? (
            <ConfirmAction
              label={`Switch off ${brand.name}`}
              icon="power"
              question={`Switch off ${brand.name}?`}
              consequence="Receipts stop being imported. A saved sign-in stays on this phone until you disconnect it."
              confirmLabel="Switch off"
              onConfirm={() => void switchPhone(false)}
              disabled={busy}
            />
          ) : null}

          <Expandable icon="help-circle-outline" title="How this works">
            <Text variant="caption" tone="muted">
              {brand.howItWorks}
            </Text>
            <Text variant="caption" tone="muted">
              {Platform.OS === "android"
                ? brand.androidNote
                : "If this does not work for you, the email route above is the reliable one: REWE and many other shops mail you the receipt."}
            </Text>
          </Expandable>
        </>
      )}
    </Card>
  );
}
