import React, { useEffect, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, View } from "react-native";
import { useRouter } from "expo-router";
import { Box, Button, Card, FgBankCircle, FgHeaderIcon, FgOnboarding, Sheet, Text, palette, typography } from "@finance/ui";
import { BANKS, connectBank, loadConnect } from "../lib/finanzguru";
import { fgEuro } from "@finance/ui";

type Data = Awaited<ReturnType<typeof loadConnect>>;

/** Connect-accounts onboarding, faithful to the Finanzguru store screenshot, backed by local accounts. */
export default function ConnectScreen() {
  const router = useRouter();
  const [data, setData] = useState<Data>({ accounts: [] });
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const load = () => { void loadConnect().then(setData); };
  useEffect(load, []);

  const banks = BANKS.filter((bank) => bank.name.toLowerCase().includes(query.toLowerCase()));
  const connect = async (name: string) => {
    await connectBank(name);
    load();
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
        <Pressable accessibilityRole="button" accessibilityLabel="Connect your bank" onPress={() => setOpen(true)} style={styles.cta}>
          <RNText style={[styles.ctaText, { fontFamily: typography.font.display }]}>Connect your bank</RNText>
        </Pressable>
      </FgOnboarding>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Connect accounts">
        <Text variant="body4" color="muted">4,000+ banks supported. Local adapter — no cloud login, no credentials stored.</Text>
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
        <TextInput
          value={query} onChangeText={setQuery} placeholder="Search your bank"
          placeholderTextColor="#9B96BA" style={styles.search}
          accessibilityLabel="Search your bank"
        />
        <ScrollView style={styles.list}>
          {banks.map((bank) => {
            const connected = data.accounts.some((a) => a.name === bank.name);
            return (
              <Pressable
                key={bank.name}
                accessibilityRole="button"
                accessibilityLabel={`Connect ${bank.name}`}
                disabled={connected}
                onPress={() => void connect(bank.name)}
                style={({ pressed }) => [styles.bankRow, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.bankIcon, { backgroundColor: bank.color }]}>
                  <RNText style={styles.bankGlyph}>{bank.emoji}</RNText>
                </View>
                <Text variant="body3" style={{ flex: 1 }}>{bank.name}</Text>
                <Text variant="body4" color={connected ? "income" : "primary"}>{connected ? "Connected ✓" : "Connect"}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
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
  search: { borderWidth: 1, borderColor: "#E4E2ED", borderRadius: 12, paddingHorizontal: 14, minHeight: 46, fontFamily: typography.font.body },
  list: { maxHeight: 260 },
  bankRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#E4E2ED" },
  bankIcon: { width: 36, height: 36, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  bankGlyph: { color: "#FFFFFF", fontWeight: "700", fontSize: 14 },
});
