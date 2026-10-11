import { Link } from "expo-router";
import { useEffect, useState } from "react";
import { Platform, ScrollView, View } from "react-native";
import { HelperText, List, SegmentedButtons, Text, TextInput } from "@/components/kit";

import { Api, type ExportData } from "@/api/client";
import { useApi } from "@/api/config";
import { PaydayPicker } from "@/components/PaydayPicker";
import { Body, Button, Card, Screen, Title, useColors } from "@/components/ui";
import { pickTextFile, shareTextFile } from "@/native/files";
import { useScreenData } from "@/hooks";

/**
 * The packaged web app is served by the server itself (FINANCER_WEB_DIR), so its own address
 * is the server address. Not in development, where the page comes from the Expo dev server.
 */
function defaultServerUrl(): string {
  if (Platform.OS !== "web" || process.env.NODE_ENV !== "production") return "";
  return globalThis.location?.origin ?? "";
}

export default function SettingsScreen() {
  const { config, api, save, clear, mode, setMode, embeddedAvailable, embedded, saveEmbedded, embeddedError } = useApi();
  const c = useColors();
  const { data: settings, setData: setSettings, error } = useScreenData((a) => a.settings());
  const [baseUrl, setBaseUrl] = useState(defaultServerUrl);
  const [token, setToken] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [model, setModel] = useState("");
  const [emb, setEmb] = useState(embedded);

  useEffect(() => {
    if (config) {
      setBaseUrl(config.baseUrl);
      setToken(config.token);
    }
  }, [config]);
  useEffect(() => {
    if (settings) setModel(settings.llm_model);
  }, [settings]);
  useEffect(() => setEmb(embedded), [embedded]);

  async function test() {
    setBusy(true);
    setStatus(null);
    try {
      const next = { baseUrl: baseUrl.trim(), token: token.trim() };
      const probe = new Api(next);
      if (!(await probe.health())) throw new Error("Server answered, but not as a Financer server");
      await probe.transactions(); // needs the token
      await save(next);
      setStatus("Connected. Settings saved.");
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not connect");
    } finally {
      setBusy(false);
    }
  }

  async function update(patch: Parameters<Api["saveSettings"]>[0]) {
    if (!api) return;
    try {
      setSettings(await api.saveSettings(patch));
      setStatus(null);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Could not save");
    }
  }

  async function exportBackup() {
    if (!api) return;
    try {
      const data = await api.exportData();
      const stamp = new Date().toISOString().slice(0, 10);
      await shareTextFile(`financer-backup-${stamp}.json`, JSON.stringify(data), "application/json");
      setStatus(`Exported ${data.transactions.length} transactions, ${data.receipts.length} receipts.`);
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "Export failed");
    }
  }

  async function importBackup() {
    if (!api) return;
    try {
      const text = await pickTextFile(["application/json", "text/plain"]);
      if (text === null) return;
      const r = await api.importData(JSON.parse(text) as ExportData);
      setStatus(
        `Imported ${r.transactions_added} new transactions (${r.transactions_known} already here) and ${r.receipts_added} receipts.`,
      );
    } catch (e) {
      setStatus(e instanceof SyntaxError ? "That file is not a Financer backup." : e instanceof Error ? e.message : "Import failed");
    }
  }

  const keyConfigured =
    settings && (settings.llm_provider === "claude" ? settings.claude_key_configured : settings.openai_key_configured);

  return (
    <Screen>
      <Title>Settings</Title>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 24 }}>
        <Card>
          <Text variant="titleMedium">Where does the backend run?</Text>
          <SegmentedButtons
            style={{ marginTop: 12 }}
            value={mode}
            onValueChange={(v) => setMode(v as "remote" | "embedded")}
            buttons={[
              { value: "remote", label: "Server", icon: "server-network" },
              { value: "embedded", label: "This phone", icon: "cellphone" },
            ]}
          />
          <Text variant="bodySmall" style={{ color: c.muted, marginTop: 8 }}>
            {mode === "remote"
              ? "A Financer server you host does the work and stores your data."
              : "Everything runs inside this app and your data never leaves the phone. On iPhone it only works while the app is open."}
          </Text>
          {mode === "embedded" && !embeddedAvailable ? (
            <HelperText type="error" visible>
              This build does not include the on-phone backend. It needs a custom build with the Rust library (see
              docs/EMBEDDED.md). Expo Go and the web build cannot run it.
            </HelperText>
          ) : null}
          {mode === "embedded" && embeddedAvailable && embeddedError ? <HelperText type="error" visible>{embeddedError}</HelperText> : null}
        </Card>

        {mode === "embedded" && embeddedAvailable ? (
          <Card>
            <Text variant="titleMedium">On-phone settings</Text>
            <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
              With no server there is nowhere else to keep these, so they are stored in this phone's secure storage.
            </Text>
            <TextInput mode="outlined" label="Claude API key" accessibilityLabel="Claude API key" value={emb.claudeApiKey} onChangeText={(v) => setEmb({ ...emb, claudeApiKey: v })} secureTextEntry autoCapitalize="none" autoCorrect={false} style={{ marginTop: 8 }} />
            <TextInput mode="outlined" label="OpenAI API key" accessibilityLabel="OpenAI API key" value={emb.openaiApiKey} onChangeText={(v) => setEmb({ ...emb, openaiApiKey: v })} secureTextEntry autoCapitalize="none" autoCorrect={false} style={{ marginTop: 8 }} />
            <TextInput mode="outlined" label="FinTS product ID" accessibilityLabel="FinTS product ID" value={emb.fintsProductId} onChangeText={(v) => setEmb({ ...emb, fintsProductId: v })} autoCapitalize="none" autoCorrect={false} style={{ marginTop: 8 }} />
            <TextInput mode="outlined" label="Price sources (JSON)" accessibilityLabel="Price sources JSON" value={emb.priceSourcesJson} onChangeText={(v) => setEmb({ ...emb, priceSourcesJson: v })} multiline numberOfLines={4} autoCapitalize="none" autoCorrect={false} style={{ marginTop: 8, minHeight: 90 }} />
            <View style={{ marginTop: 12 }}>
              <Button label="Save and restart backend" icon="content-save-outline" onPress={() => saveEmbedded(emb)} />
            </View>
          </Card>
        ) : null}

        {mode === "remote" ? (
        <Card>
          <Text variant="titleMedium">Server</Text>
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
            style={{ marginTop: 8 }}
          />
          <TextInput
            mode="outlined"
            label="API token"
            value={token}
            onChangeText={setToken}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            accessibilityLabel="API token"
            style={{ marginTop: 8 }}
          />
          <View style={{ marginTop: 12 }}>
            <Button label={busy ? "Connecting…" : "Test and save"} icon="server-network" onPress={test} disabled={busy || !baseUrl.trim() || !token.trim()} />
          </View>
          {config ? (
            <Button
              mode="text"
              label="Forget this server"
              onPress={() => {
                void clear();
                setBaseUrl(defaultServerUrl());
                setToken("");
                setStatus(null);
              }}
            />
          ) : null}
        </Card>
        ) : null}

        {api && settings ? (
          <>
            <Card>
              <Text variant="titleMedium">When do you get paid?</Text>
              <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
                Your budget month runs from payday to the day before the next one, so limits and the daily number line up with
                your salary. Day 1 is the calendar month.
              </Text>
              <PaydayPicker value={settings.payday} onChange={(day) => update({ payday: day })} />
            </Card>

            <Card>
              <Text variant="titleMedium">How should I learn what you buy?</Text>
              <SegmentedButtons
                style={{ marginTop: 12 }}
                value={settings.habit_mode}
                onValueChange={(v) => update({ habit_mode: v })}
                buttons={[
                  { value: "manual", label: "My list" },
                  { value: "receipts", label: "Receipts" },
                  { value: "spending", label: "Estimate" },
                ]}
              />
              <Text variant="bodySmall" style={{ color: c.muted, marginTop: 8 }}>
                Your bank only shows "REWE, 23,47 €", not what was in the bag. "Estimate" uses a generic basket.
              </Text>
              <Link href="/basket" asChild>
                <List.Item title="Edit my usual items" left={() => <List.Icon icon="format-list-checks" />} right={() => <List.Icon icon="chevron-right" />} />
              </Link>
              <Link href="/receipts" asChild>
                <List.Item title="Receipts" left={() => <List.Icon icon="receipt-text-outline" />} right={() => <List.Icon icon="chevron-right" />} />
              </Link>
            </Card>

            <Card>
              <Text variant="titleMedium">Recipe ideas by AI</Text>
              <SegmentedButtons
                style={{ marginTop: 12 }}
                value={settings.llm_provider}
                onValueChange={(v) => update({ llm_provider: v })}
                buttons={[
                  { value: "claude", label: "Claude" },
                  { value: "open_ai", label: "OpenAI" },
                ]}
              />
              <TextInput
                mode="outlined"
                label="Model (empty = default)"
                accessibilityLabel="Model (empty = default)"
                value={model}
                onChangeText={setModel}
                onEndEditing={() => model !== settings.llm_model && update({ llm_model: model })}
                autoCapitalize="none"
                autoCorrect={false}
                style={{ marginTop: 12 }}
              />
              <HelperText type={keyConfigured ? "info" : "error"} visible>
                {keyConfigured
                  ? "An API key is configured on the server."
                  : settings.llm_provider === "claude"
                    ? "No key yet: set FINANCER_ANTHROPIC_API_KEY on the server."
                    : "No key yet: set FINANCER_OPENAI_API_KEY on the server."}
              </HelperText>
              <Text variant="bodySmall" style={{ color: c.muted }}>
                Only item names, offers, diet and budget are sent, never bank data.
              </Text>
            </Card>

            <Card>
              <Text variant="titleMedium">Your data</Text>
              <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
                A backup file holds your transactions, budget, usual items and receipts, never PINs, tokens or API keys.
                Use it to back up, or to move between a server and this phone. Importing twice changes nothing.
              </Text>
              <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
                <View style={{ flex: 1 }}>
                  <Button label="Export" icon="export" onPress={exportBackup} />
                </View>
                <View style={{ flex: 1 }}>
                  <Button label="Import" icon="import" mode="outlined" onPress={importBackup} />
                </View>
              </View>
            </Card>

            <Card>
              <Body>
                {settings.price_sources} price source{settings.price_sources === 1 ? "" : "s"} configured on the server.
              </Body>
            </Card>
          </>
        ) : null}
        {status || error ? <HelperText type="info" visible>{status ?? error}</HelperText> : null}
      </ScrollView>
    </Screen>
  );
}
