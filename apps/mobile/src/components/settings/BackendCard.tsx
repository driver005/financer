import { useEffect, useState } from "react";
import { Platform, View } from "react-native";

import { Api } from "@/api/client";
import { useApi } from "@/api/config";
import { TextInput } from "@/components/kit";
import { ConfirmAction, FieldMessage, PanelDivider, PanelText, Segmented, SettingsPanel } from "@/components/settings/SettingsKit";
import { Button } from "@/components/ui";
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
      const probe = new Api(next);
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
    <>
      <SettingsPanel
        icon={mode === "embedded" ? "cellphone-lock" : "server-network"}
        title="Backend"
        summary={`${conn.where} · ${conn.status}`}
        defaultOpen={conn.tone === "off"}
      >
        <PanelText style={{ marginTop: 4 }}>Where does the backend run?</PanelText>
        <Segmented
          style={{ marginTop: 8 }}
          value={mode}
          onValueChange={(v) => setMode(v as "remote" | "embedded")}
          buttons={[
            { value: "remote", label: "Server", icon: "server-network" },
            { value: "embedded", label: "This phone", icon: "cellphone" },
          ]}
        />
        <PanelText>
          {mode === "remote"
            ? "A Financer server you host does the work and stores your data."
            : "Everything runs inside this app and your data never leaves the phone. On iPhone it only works while the app is open."}
        </PanelText>
        <FieldMessage tone={conn.tone === "ok" ? "ok" : conn.tone === "bad" ? "error" : "info"}>
          {conn.status}
        </FieldMessage>
        {mode === "embedded" && !embeddedAvailable ? (
          <FieldMessage tone="error">
            This build does not include the on-phone backend. It needs a custom build with the Rust library (see docs/EMBEDDED.md). Expo Go and the web build cannot run it.
          </FieldMessage>
        ) : null}

        {mode === "remote" ? (
          <>
            <PanelDivider />
            <TextInput
              mode="outlined"
              label="Address (use https://)"
              value={baseUrl}
              onChangeText={setBaseUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              placeholder="https://financer.example.com"
              accessibilityLabel="Address (use https://)"
              error={!!addressProblem}
            />
            {addressProblem ? <FieldMessage tone="error">{addressProblem}</FieldMessage> : null}
            <View style={{ height: 8 }} />
            <TextInput
              mode="outlined"
              label="API token"
              value={token}
              onChangeText={setToken}
              onBlur={() => setTokenTouched(true)}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              accessibilityLabel="API token"
              error={!!tokenProblem}
            />
            {tokenProblem ? <FieldMessage tone="error">{tokenProblem}</FieldMessage> : null}
            {check.ok && check.warning ? <FieldMessage tone="error">{check.warning}</FieldMessage> : null}
            <PanelText>The token stays on this device and is only sent to this address.</PanelText>
            <View style={{ marginTop: 12 }}>
              <Button
                label={busy ? "Connecting…" : "Test and save"}
                icon="server-network"
                onPress={test}
                disabled={busy || !baseUrl.trim() || !token.trim()}
              />
            </View>
            {status ? <FieldMessage tone={status.ok ? "ok" : "error"}>{status.text}</FieldMessage> : null}
            {config ? (
              <>
                <PanelDivider />
                <PanelText style={{ marginTop: 0, marginBottom: 8, fontWeight: "700" }}>Danger zone</PanelText>
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
      </SettingsPanel>

      {mode === "embedded" && embeddedAvailable ? (
        <SettingsPanel icon="key-chain-variant" title="On-phone settings" summary="API keys and sources, kept in secure storage">
          <PanelText style={{ marginTop: 4 }}>With no server there is nowhere else to keep these, so they are stored in this phone's secure storage.</PanelText>
          <View style={{ gap: 8, marginTop: 8 }}>
            <TextInput mode="outlined" label="Claude API key" accessibilityLabel="Claude API key" value={emb.claudeApiKey} onChangeText={(v) => setEmb({ ...emb, claudeApiKey: v })} secureTextEntry autoCapitalize="none" autoCorrect={false} />
            <TextInput mode="outlined" label="OpenAI API key" accessibilityLabel="OpenAI API key" value={emb.openaiApiKey} onChangeText={(v) => setEmb({ ...emb, openaiApiKey: v })} secureTextEntry autoCapitalize="none" autoCorrect={false} />
            <TextInput mode="outlined" label="FinTS product ID" accessibilityLabel="FinTS product ID" value={emb.fintsProductId} onChangeText={(v) => setEmb({ ...emb, fintsProductId: v })} autoCapitalize="none" autoCorrect={false} />
            <TextInput mode="outlined" label="Price sources (JSON)" accessibilityLabel="Price sources JSON" value={emb.priceSourcesJson} onChangeText={(v) => setEmb({ ...emb, priceSourcesJson: v })} multiline numberOfLines={4} autoCapitalize="none" autoCorrect={false} style={{ minHeight: 90 }} />
          </View>
          {embeddedError ? <FieldMessage tone="error">{embeddedError}</FieldMessage> : null}
          <View style={{ marginTop: 12 }}>
            <Button label="Save and restart backend" icon="content-save-outline" onPress={() => saveEmbedded(emb)} />
          </View>
        </SettingsPanel>
      ) : null}
    </>
  );
}
