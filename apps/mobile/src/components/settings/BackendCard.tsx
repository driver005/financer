import { useEffect, useState } from "react";
import { Platform } from "react-native";
import { Box, Button, ConfirmAction, Divider, Expandable, Note, Segmented, Text, TextField } from "@financer/ui";

import { connectApi } from "@/api/connect";
import { useApi } from "@/api/config";
import { validateServer } from "@/onboarding";
import { connectionState, type ConnectionState } from "@/settingsPlan";

/**
 * The packaged web app is served by the server itself (FINANCER_WEB_DIR), so its own address
 * is the server address. Not in development, where the page comes from the Expo dev server.
 */
function defaultServerUrl(): string {
  if (Platform.OS !== "web" || process.env.NODE_ENV !== "production") return "";
  return globalThis.location?.origin ?? "";
}

/**
 * Settings, Account & data: where the backend runs (a server or this phone), the server address
 * and token with inline checks, the on-phone keys, and, set apart at the bottom, forgetting the
 * server. `settingsLoaded` / `settingsError` come from the screen's own settings request and feed
 * the read-only status row.
 */
export function BackendCard({ settingsLoaded, settingsError }: { settingsLoaded: boolean; settingsError: string | null }) {
  const { loaded, config, save, clear, mode, setMode, embeddedAvailable, embedded, saveEmbedded, embeddedError } = useApi();
  const [baseUrl, setBaseUrl] = useState(defaultServerUrl);
  const [token, setToken] = useState("");
  const [tokenTouched, setTokenTouched] = useState(false);
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [emb, setEmb] = useState(embedded);

  useEffect(() => {
    if (config) {
      setBaseUrl(config.baseUrl);
      setToken(config.token);
    }
  }, [config]);
  useEffect(() => setEmb(embedded), [embedded]);

  const conn: ConnectionState = connectionState({
    mode,
    hasConfig: config !== null,
    baseUrl: config?.baseUrl,
    embeddedAvailable,
    embeddedError,
    settingsLoaded,
    settingsError,
  });

  // inline checks: the address as soon as something is typed, the token once the field was left
  const addressCheck = baseUrl.trim() ? validateServer(baseUrl, "x") : null;
  const addressProblem = addressCheck && !addressCheck.ok && addressCheck.error !== "Enter the API token you set on the server." ? addressCheck.error : null;
  const tokenProblem = tokenTouched && !token.trim() ? "Enter the API token you set on the server." : null;
  const check = validateServer(baseUrl, token);

  async function test() {
    setBusy(true);
    setStatus(null);
    try {
      const next = { baseUrl: baseUrl.trim(), token: token.trim() };
      const probe = await connectApi(next);
      if (!(await probe.health())) throw new Error("Server answered, but not as a Financer server");
      await probe.transactions(); // needs the token
      await save(next);
      setStatus({ text: "Connected. Settings saved.", ok: true });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : "Could not connect", ok: false });
    } finally {
      setBusy(false);
    }
  }

  // wait for the stored address: the panel opens by itself only when there is none
  if (!loaded) return null;
  return (
    <Box>
      <Expandable icon={mode === "embedded" ? "cellphone-lock" : "server-network"} title="Backend" summary={`${conn.where} · ${conn.status}`} defaultOpen={conn.tone === "off"}>
        <Text variant="caption" tone="muted">Where does the backend run?</Text>
        <Segmented
          value={mode}
          onChange={(v) => setMode(v)}
          options={[
            { value: "remote", label: "Server" },
            { value: "embedded", label: "This phone" },
          ]}
        />
        <Text variant="caption" tone="muted">
          {mode === "remote" ? "A Financer server you host does the work and stores your data." : "Everything runs inside this app and your data never leaves the phone. On iPhone it only works while the app is open."}
        </Text>
        <Note tone={conn.tone === "ok" ? "ok" : conn.tone === "bad" ? "error" : "info"}>{conn.status}</Note>
        {mode === "embedded" && !embeddedAvailable ? (
          <Note tone="error">This build does not include the on-phone backend. It needs a custom build with the Rust library (see docs/EMBEDDED.md). Expo Go and the web build cannot run it.</Note>
        ) : null}

        {mode === "remote" ? (
          <>
            <Divider />
            <TextField label="Address (use https://)" value={baseUrl} onChangeText={setBaseUrl} keyboardType="url" placeholder="https://financer.example.com" error={addressProblem ?? undefined} />
            <TextField label="API token" value={token} onChangeText={setToken} secure error={tokenProblem ?? undefined} onBlur={() => setTokenTouched(true)} />
            {check.ok && check.warning ? <Note tone="error">{check.warning}</Note> : null}
            <Text variant="caption" tone="muted">The token stays on this device and is only sent to this address.</Text>
            <Button label={busy ? "Connecting…" : "Test and save"} icon="server-network" onPress={test} disabled={busy || !baseUrl.trim() || !token.trim()} />
            {status ? <Note tone={status.ok ? "ok" : "error"}>{status.text}</Note> : null}
            {config ? (
              <>
                <Divider />
                <Text variant="bodyStrong">Danger zone</Text>
                <ConfirmAction
                  label="Forget this server"
                  icon="server-remove"
                  question="Forget this server?"
                  consequence="The address and token are removed from this device. Your data stays on the server; connect again to see it."
                  confirmLabel="Yes, forget it"
                  onConfirm={() => {
                    void clear();
                    setBaseUrl(defaultServerUrl());
                    setToken("");
                    setTokenTouched(false);
                    setStatus(null);
                  }}
                />
              </>
            ) : null}
          </>
        ) : null}
      </Expandable>

      {mode === "embedded" && embeddedAvailable ? (
        <Expandable icon="key-chain-variant" title="On-phone settings" summary="API keys and sources, kept in secure storage">
          <Text variant="caption" tone="muted">With no server there is nowhere else to keep these, so they are stored in this phone's secure storage.</Text>
          <TextField label="Claude API key" value={emb.claudeApiKey} onChangeText={(v) => setEmb({ ...emb, claudeApiKey: v })} secure />
          <TextField label="OpenAI API key" value={emb.openaiApiKey} onChangeText={(v) => setEmb({ ...emb, openaiApiKey: v })} secure />
          <TextField label="FinTS product ID" value={emb.fintsProductId} onChangeText={(v) => setEmb({ ...emb, fintsProductId: v })} />
          <TextField label="Price sources (JSON)" value={emb.priceSourcesJson} onChangeText={(v) => setEmb({ ...emb, priceSourcesJson: v })} multiline />
          {embeddedError ? <Note tone="error">{embeddedError}</Note> : null}
          <Button label="Save and restart backend" icon="content-save-outline" onPress={() => saveEmbedded(emb)} />
        </Expandable>
      ) : null}
    </Box>
  );
}
