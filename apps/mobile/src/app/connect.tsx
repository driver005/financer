import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Box, Button, Card, Chip, FgBankCircle, FgHeaderIcon, FgOnboarding, Sheet, Text, TextField, palette, typography } from "@finance/ui";
import { fgEuro } from "@finance/ui";
import { BANKS, connectBank, loadConnect } from "../lib/finanzguru";
import {
  createRequisition, importRequisition, listInstitutions, loadProviderConfig,
  openBankLogin, saveProviderConfig, type Institution, type ProviderConfig,
} from "../lib/bankProvider";
import { connectWithPlaid, loadPlaidConfig, plaidAvailable, savePlaidConfig, type PlaidConfig } from "../lib/plaidProvider";
import { connectCustom, loadCustomConfig, saveCustomConfig, type CustomConfig } from "../lib/customProvider";

type Data = Awaited<ReturnType<typeof loadConnect>>;

/** Connect-accounts onboarding, faithful to the store screenshot, with local and real PSD2 adapters. */
export default function ConnectScreen() {
  const router = useRouter();
  const [data, setData] = useState<Data>({ accounts: [] });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"local" | "psd2" | "plaid" | "custom">("local");
  const [config, setConfig] = useState<ProviderConfig>({ secretId: "", secretKey: "", redirectUri: "", agreement: "" });
  const [institutions, setInstitutions] = useState<Institution[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [plaidConfig, setPlaidConfig] = useState<PlaidConfig>({ backendUrl: "", clientId: "", environment: "sandbox", userId: "pantry-local-user" });
  const [customConfig, setCustomConfig] = useState<CustomConfig>({ endpoint: "", token: "" });

  const load = () => { void loadConnect().then(setData); };
  useEffect(load, []);

  const openSheet = () => {
    void loadProviderConfig().then(setConfig);
    void loadPlaidConfig().then(setPlaidConfig);
    void loadCustomConfig().then(setCustomConfig);
    setMessage(null); setOpen(true);
  };

  const banks = BANKS.filter((bank) => bank.name.toLowerCase().includes(query.toLowerCase()));

  const connect = async (name: string) => {
    await connectBank(name);
    load();
  };

  const saveConfig = async () => {
    await saveProviderConfig(config);
    setMessage("Provider credentials saved to secure storage.");
  };

  const findBanks = async () => {
    setBusy(true); setMessage(null);
    try {
      const list = await listInstitutions("DE");
      setInstitutions(list.slice(0, 40));
      setMessage(`${list.length} institutions available via your provider.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not list banks"); }
    finally { setBusy(false); }
  };

  const connectInstitution = async (institution: Institution) => {
    setBusy(true); setMessage(null);
    try {
      const requisition = await createRequisition(institution.id);
      const result = await openBankLogin(requisition.link);
      if (result.cancelled || !result.ref) { setMessage("Bank login cancelled."); return; }
      const imported = await importRequisition(result.ref);
      load();
      setMessage(`Imported ${imported.imported} transactions from ${institution.name}.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Bank connection failed"); }
    finally { setBusy(false); }
  };

  const launchCustom = async () => {
    setBusy(true); setMessage(null);
    try {
      await saveCustomConfig(customConfig);
      const result = await connectCustom();
      load();
      setMessage(`Imported ${result.imported} transactions from ${result.accounts} accounts.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Bank import failed"); }
    finally { setBusy(false); }
  };

  const launchPlaid = async () => {
    setBusy(true); setMessage(null);
    try { await savePlaidConfig(plaidConfig); const result = await connectWithPlaid(); setMessage(result.message); load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Plaid connection failed"); }
    finally { setBusy(false); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: palette.primary }}>
      <View style={styles.topBar}>
        <FgHeaderIcon name="close" label="Close" onPress={() => router.back()} />
      </View>
      <FgOnboarding title="Connect accounts">
        <View style={styles.circles}>
          <FgBankCircle emoji="S" color="#E30613" size={80} style={{ top: 4, left: "50%", marginLeft: -40 }} />
          <FgBankCircle emoji="S" color="#1CD9B0" size={88} style={{ top: 104, left: 12 }} />
          <FgBankCircle emoji="N26" color="#111111" size={84} style={{ top: 140, right: 8 }} />
          <FgBankCircle emoji="▲" color="#F2A93B" size={82} style={{ top: 242, left: "34%" }} />
          <FgBankCircle emoji="P" color="#0070BA" size={88} style={{ top: 318, right: 6 }} />
          <FgBankCircle emoji="🦁" size={82} style={{ top: 418, left: "28%" }} />
        </View>
        <Text variant="body3" style={styles.note}>{`${data.accounts.length} account${data.accounts.length === 1 ? "" : "s"} connected locally`}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Connect your bank" onPress={openSheet} style={styles.cta}>
          <RNText style={[styles.ctaText, { fontFamily: typography.font.display }]}>Connect your bank</RNText>
        </Pressable>
      </FgOnboarding>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Connect accounts">
        <Chip label="Demo banks" selected={mode === "local"} onPress={() => setMode("local")} />
        <Chip label="Real PSD2" selected={mode === "psd2"} onPress={() => setMode("psd2")} />
        <Chip label="Plaid" selected={mode === "plaid"} onPress={() => setMode("plaid")} />
        <Chip label="Custom API" selected={mode === "custom"} onPress={() => setMode("custom")} />
        {message ? <Text variant="body3" color="accent">{message}</Text> : null}

        {mode === "psd2" ? (
          <>
            <Text variant="body4" color="muted">GoCardless Bank Account Data API. Credentials stay in Expo SecureStore; bank login opens in a secure browser. You need a free developer account.</Text>
            <TextField label="Secret ID" value={config.secretId} onChangeText={(v) => setConfig({ ...config, secretId: v })} />
            <TextField label="Secret Key" value={config.secretKey} onChangeText={(v) => setConfig({ ...config, secretKey: v })} />
            <TextField label="Redirect URI" value={config.redirectUri} onChangeText={(v) => setConfig({ ...config, redirectUri: v })} />
            <TextField label="Agreement ID (optional)" value={config.agreement} onChangeText={(v) => setConfig({ ...config, agreement: v })} />
            <Button label="Save credentials" icon="lock" onPress={() => void saveConfig()} />
            <Button label="Find my bank" icon="magnify" onPress={() => void findBanks()} disabled={busy} />
            <ScrollView style={styles.list}>
              {institutions.map((bank) => (
                <Pressable key={bank.id} accessibilityRole="button" accessibilityLabel={`Connect ${bank.name}`}
                  disabled={busy} onPress={() => void connectInstitution(bank)} style={styles.bankRow}>
                  <View style={[styles.bankIcon, { backgroundColor: palette.primary }]}><RNText style={styles.bankGlyph}>{bank.name.slice(0, 1)}</RNText></View>
                  <Text variant="body3" style={{ flex: 1 }}>{bank.name}</Text>
                  <Text variant="body4" color="primary">Connect</Text>
                </Pressable>
              ))}
            </ScrollView>
          </>
        ) : mode === "plaid" ? (
          <>
            <Text variant="body4" color="muted">Plaid Link v13 native SDK. Your HTTPS backend creates the link_token and exchanges the public_token. Requires a development build — not Expo Go or web.</Text>
            <TextField label="Backend URL" value={plaidConfig.backendUrl} onChangeText={(v) => setPlaidConfig({ ...plaidConfig, backendUrl: v })} placeholder="https://your-server.com" />
            <TextField label="Client ID" value={plaidConfig.clientId} onChangeText={(v) => setPlaidConfig({ ...plaidConfig, clientId: v })} />
            <TextField label="User ID" value={plaidConfig.userId} onChangeText={(v) => setPlaidConfig({ ...plaidConfig, userId: v })} />
            <Chip label="Sandbox" selected={plaidConfig.environment === "sandbox"} onPress={() => setPlaidConfig({ ...plaidConfig, environment: "sandbox" })} />
            <Chip label="Production" selected={plaidConfig.environment === "production"} onPress={() => setPlaidConfig({ ...plaidConfig, environment: "production" })} />
            <Text variant="body5" color="muted">{plaidAvailable() ? "Native Link SDK available." : "Native Link SDK unavailable on this platform."}</Text>
            <Button label="Connect with Plaid" icon="bank" onPress={() => void launchPlaid()} disabled={busy} />
          </>
        ) : mode === "custom" ? (
          <>
            <Text variant="body4" color="muted">Point at any HTTPS bank-data backend (TrueLayer, Tink, Yapily or self-hosted). It returns accounts and transactions; everything is stored locally.</Text>
            <TextField label="Endpoint URL" value={customConfig.endpoint} onChangeText={(v) => setCustomConfig({ ...customConfig, endpoint: v })} placeholder="https://your-server.com/banks" />
            <TextField label="Bearer token" value={customConfig.token} onChangeText={(v) => setCustomConfig({ ...customConfig, token: v })} />
            <Button label="Import accounts" icon="download" onPress={() => void launchCustom()} disabled={busy} />
          </>
        ) : (
          <>
            <Text variant="body4" color="muted">Local adapter with 12 example banks — no credentials stored, no cloud connection. Use Real PSD2, Plaid or Custom API for live banks.</Text>
            {data.accounts.length ? (
              <Card>
                <Text variant="heading6">Connected</Text>
                {data.accounts.map((account) => (
                  <Box key={account.id} row style={{ justifyContent: "space-between" }}>
                    <Text variant="body3">{account.name}</Text>
                    <Text variant="body4" color="muted">{fgEuro(account.balanceCents)}</Text>
                  </Box>
                ))}
              </Card>
            ) : null}
            <TextInput value={query} onChangeText={setQuery} placeholder="Search your bank"
              placeholderTextColor="#9B96BA" style={styles.search} accessibilityLabel="Search your bank" />
            <ScrollView style={styles.list}>
              {banks.map((bank) => {
                const connected = data.accounts.some((a) => a.name === bank.name);
                return (
                  <Pressable key={bank.name} accessibilityRole="button" accessibilityLabel={`Connect ${bank.name}`}
                    disabled={connected} onPress={() => void connect(bank.name)} style={({ pressed }) => [styles.bankRow, pressed && { opacity: 0.7 }]}>
                    <View style={[styles.bankIcon, { backgroundColor: bank.color }]}><RNText style={styles.bankGlyph}>{bank.emoji}</RNText></View>
                    <Text variant="body3" style={{ flex: 1 }}>{bank.name}</Text>
                    <Text variant="body4" color={connected ? "income" : "primary"}>{connected ? "Connected ✓" : "Connect"}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </>
        )}
        <Button label="Done" variant="secondary" onPress={() => setOpen(false)} />
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: { position: "absolute", top: 8, right: 12, zIndex: 2 },
  circles: { flex: 1, width: "100%", marginTop: 36 },
  note: { color: "#D9D5F2", marginBottom: 12 },
  cta: { backgroundColor: "#FFFFFF", borderRadius: 999, paddingHorizontal: 28, paddingVertical: 14, marginBottom: 48 },
  ctaText: { color: palette.primary, fontSize: 16, fontWeight: "700" },
  search: { borderWidth: 1, borderColor: "#E5E5E5", borderRadius: 12, paddingHorizontal: 14, minHeight: 46, fontFamily: typography.font.body },
  list: { maxHeight: 220 },
  bankRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#E5E5E5" },
  bankIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  bankGlyph: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
});
