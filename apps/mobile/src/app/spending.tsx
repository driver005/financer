import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from "react-native";
import { Link, useFocusEffect } from "expo-router";

import type { Split, Transaction } from "@/api/client";
import { useApi } from "@/api/config";
import { CategorizationTools } from "@/components/CategorizationTools";
import { RecategorizeSheet } from "@/components/RecategorizeSheet";
import { TransactionRow } from "@/components/TransactionRow";
import { Body, Button, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { pickFileBytes } from "@/native/files";

export default function Spending() {
  const { api, loaded } = useApi();
  const c = useColors();
  const [items, setItems] = useState<Transaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [splits, setSplits] = useState<Split[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      setItems(await api.transactions());
      setSplits(await api.splits());
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load transactions");
    } finally {
      setBusy(false);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const importCsv = useCallback(async () => {
    if (!api) return;
    try {
      const bytes = await pickFileBytes(["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain"]);
      if (bytes === null) return;
      setBusy(true);
      const r = await api.importCsv(bytes);
      const skipped = r.skipped.length ? `, ${r.skipped.length} unreadable` : "";
      setMessage(`Imported ${r.imported} new, ${r.duplicates} already known${skipped}`);
      setItems(await api.transactions());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }, [api]);

  if (!loaded) return <Screen><ActivityIndicator style={{ marginTop: 40 }} /></Screen>;

  return (
    <Screen>
      <Title>Spending</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <>
          <Link href="/sync" asChild>
            <Button label="Sync with Sparkasse" icon="bank-transfer" onPress={() => {}} />
          </Link>
          <View style={{ height: 8 }} />
          <Button label="Import Sparkasse CSV" icon="file-delimited-outline" mode="outlined" onPress={importCsv} disabled={busy} />
          {message ? <Text style={{ color: c.muted, marginVertical: 8 }}>{message}</Text> : null}
          <RecategorizeSheet
            tx={selected}
            split={splits.find((s) => s.transaction_id === selected?.id)}
            onClose={() => setSelected(null)}
            onChanged={async (note) => {
              setSelected(null);
              await load();
              setMessage(note);
            }}
          />
          <FlatList
            style={{ marginTop: 8 }}
            data={items}
            keyExtractor={(t) => String(t.id)}
            refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}
            ListEmptyComponent={busy ? null : <Body muted>No transactions yet. Import a CSV export from Sparkasse online banking.</Body>}
            ListHeaderComponent={<CategorizationTools onChanged={(note) => void load().then(() => setMessage(note))} />}
            renderItem={({ item }) => (
              <TransactionRow item={item} split={splits.some((s) => s.transaction_id === item.id)} onPress={() => setSelected(item)} />
            )}
          />
        </>
      )}
    </Screen>
  );
}
