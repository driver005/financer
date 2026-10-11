import { File } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import { useCallback, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, View } from "react-native";
import { Link, useFocusEffect } from "expo-router";

import type { Transaction } from "@/api/client";
import { useApi } from "@/api/config";
import { Body, Button, Card, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";

export default function Transactions() {
  const { api, loaded } = useApi();
  const c = useColors();
  const [items, setItems] = useState<Transaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      setItems(await api.transactions());
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
      const picked = await DocumentPicker.getDocumentAsync({
        type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain"],
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      setBusy(true);
      const bytes = await new File(picked.assets[0].uri).arrayBuffer();
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
          <FlatList
            style={{ marginTop: 8 }}
            data={items}
            keyExtractor={(t) => String(t.id)}
            refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}
            ListEmptyComponent={busy ? null : <Body muted>No transactions yet. Import a CSV export from Sparkasse online banking.</Body>}
            renderItem={({ item }) => (
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Body bold>{item.counterparty || "Unknown"}</Body>
                    <Text numberOfLines={1} style={{ color: c.muted, fontSize: 13 }}>
                      {formatDate(item.booking_date)} · {item.category ?? "uncategorized"}
                    </Text>
                  </View>
                  <Text style={{ color: item.amount_cents < 0 ? c.text : c.good, fontSize: 16, fontWeight: "600" }}>
                    {formatCents(item.amount_cents)}
                  </Text>
                </View>
              </Card>
            )}
          />
        </>
      )}
    </Screen>
  );
}
