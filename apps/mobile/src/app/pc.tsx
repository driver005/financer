import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, IconButton, Screen, SectionTitle, Text, TextField } from "../ui/primitives";
import { tokens } from "../ui/theme";
import { allTransactions, updateTransaction } from "../db/moneyTracker";
import { parseEuro } from "../lib/money";

type Row = { id: number; date: string; merchant: string; amountCents: number; category: string };

export default function PcScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [edits, setEdits] = useState<Record<number, { amount: string; category: string }>>({});
  const [message, setMessage] = useState<string | null>(null);

  const load = async () => {
    const data = await allTransactions();
    setRows(data as unknown as Row[]);
    setEdits(Object.fromEntries((data as unknown as Row[]).map((row) => [row.id, { amount: String(row.amountCents / 100).replace(".", ","), category: row.category }])));
  };

  useEffect(() => { void load(); }, []);

  const saveRow = async (row: Row) => {
    const cents = parseEuro(edits[row.id]?.amount ?? "");
    if (cents === null) { setMessage("Invalid amount."); return; }
    await updateTransaction(row.id, { amountCents: cents, category: edits[row.id]?.category || row.category });
    setMessage(`Saved row ${row.id}.`);
    await load();
  };

  return (
    <Screen
      title="PC editor"
      subtitle="Open this page on a laptop on the same network"
      back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
    >
      {message ? <Text color="accent">{message}</Text> : null}
      <Card>
        <SectionTitle>Transactions</SectionTitle>
        <Text variant="caption" color="muted">Edit amounts and categories in a wide table. All changes stay in this app's local database.</Text>
      </Card>
      <ScrollView horizontal>
        <View style={styles.table}>
          <View style={styles.head}>
            <Text variant="label" style={styles.colDate}>Date</Text>
            <Text variant="label" style={styles.colMerchant}>Merchant</Text>
            <Text variant="label" style={styles.colAmount}>Amount</Text>
            <Text variant="label" style={styles.colCategory}>Category</Text>
            <Text variant="label" style={styles.colAction}>Save</Text>
          </View>
          {rows.map((row) => (
            <View key={row.id} style={styles.tableRow}>
              <Text variant="caption" style={styles.colDate}>{row.date}</Text>
              <Text variant="caption" style={styles.colMerchant}>{row.merchant}</Text>
              <TextField label="" value={edits[row.id]?.amount ?? ""} onChangeText={(value) => setEdits((prev) => ({ ...prev, [row.id]: { ...(prev[row.id] ?? { category: row.category }), amount: value } }))} />
              <TextField label="" value={edits[row.id]?.category ?? ""} onChangeText={(value) => setEdits((prev) => ({ ...prev, [row.id]: { ...(prev[row.id] ?? { amount: "" }), category: value } }))} />
              <View style={styles.colAction}><Button label="Save" tone="secondary" onPress={() => void saveRow(row)} /></View>
            </View>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  table: { gap: 2 },
  head: { flexDirection: "row", alignItems: "center", gap: tokens.sm, paddingBottom: tokens.sm },
  tableRow: { flexDirection: "row", alignItems: "center", gap: tokens.sm },
  colDate: { width: 100 },
  colMerchant: { width: 150 },
  colAmount: { width: 110 },
  colCategory: { width: 150 },
  colAction: { width: 90 },
});
