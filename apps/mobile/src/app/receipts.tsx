import { useState } from "react";
import { FlatList, View } from "react-native";
import { HelperText, IconButton, Text, TextInput } from "react-native-paper";

import type { Receipt } from "@/api/client";
import { useApi } from "@/api/config";
import { Body, Button, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";
import { useScreenData } from "@/hooks";

export default function Receipts() {
  const { api, loaded } = useApi();
  const c = useColors();
  const { data, error, reload } = useScreenData((a) => a.receipts());
  const [text, setText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!api || !text.trim()) return;
    setBusy(true);
    try {
      const r = await api.uploadReceipt(text);
      setMessage(
        r.duplicate
          ? "This receipt was already added."
          : r.reconciles
            ? `Added ${r.items.length} items; they add up to the total.`
            : `Added ${r.items.length} items, but they do not add up to the printed total. Check the text for missing lines.`,
      );
      setText("");
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not add receipt");
    } finally {
      setBusy(false);
    }
  }

  async function remove(r: Receipt) {
    if (!api || r.id == null) return;
    try {
      await api.deleteReceipt(r.id);
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not delete");
    }
  }

  if (!loaded) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <Title>Receipts</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(r) => String(r.id)}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View style={{ marginBottom: 8 }}>
              <Text variant="bodyMedium" style={{ color: c.muted, marginBottom: 8 }}>
                Paste the text of a receipt. Scanning a photo with your camera needs a text-recognition module in
                a custom build and is not part of this version.
              </Text>
              <TextInput
                mode="outlined"
                label="Receipt text"
                accessibilityLabel="Receipt text"
                value={text}
                onChangeText={setText}
                multiline
                numberOfLines={6}
                style={{ minHeight: 120 }}
              />
              <View style={{ marginTop: 12 }}>
                <Button label={busy ? "Adding…" : "Add receipt"} icon="receipt-text-plus-outline" onPress={add} disabled={busy || !text.trim()} />
              </View>
              {message || error ? <HelperText type="info" visible>{message ?? error}</HelperText> : null}
            </View>
          }
          ListEmptyComponent={<Body muted>No receipts yet.</Body>}
          renderItem={({ item }) => (
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Body bold>{item.merchant ?? "Receipt"}</Body>
                  <Text variant="bodySmall" style={{ color: c.muted }}>
                    {item.date ? formatDate(item.date) : "no date"} · {item.items.length} items
                    {item.total_cents != null ? ` · ${formatCents(item.total_cents)}` : ""}
                    {item.reconciles ? "" : " · check"}
                  </Text>
                </View>
                <IconButton icon="delete-outline" onPress={() => remove(item)} accessibilityLabel="Delete receipt" />
              </View>
            </Card>
          )}
        />
      )}
    </Screen>
  );
}
