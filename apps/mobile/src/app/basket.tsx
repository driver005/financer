import { useEffect, useMemo, useState } from "react";
import { FlatList, View } from "react-native";
import { HelperText, IconButton, List, Searchbar, Text } from "react-native-paper";

import type { BasketItem, CatalogItem } from "@/api/client";
import { useApi } from "@/api/config";
import { Body, Button, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { useScreenData } from "@/hooks";

const SOURCE_NOTE: Record<string, string> = {
  manual: "Your own list.",
  receipts: "Learned from your receipts. Editing here switches nothing; set the habit mode in Settings.",
  starter: "A generic starter basket. Save your own list to replace it.",
};

export default function BasketScreen() {
  const { api, loaded } = useApi();
  const c = useColors();
  const { data, error, reload } = useScreenData(async (a) => ({ basket: await a.basket(), catalog: await a.catalog() }));
  const [items, setItems] = useState<BasketItem[]>([]);
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) setItems(data.basket.items.map((i) => ({ item: i.item, quantity: i.quantity })));
  }, [data]);

  const catalog: CatalogItem[] = data?.catalog ?? [];
  const nameOf = (key: string) => catalog.find((x) => x.key === key)?.name ?? key;
  const packOf = (key: string) => catalog.find((x) => x.key === key)?.reference_pack ?? "";

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return catalog.filter((x) => x.name.toLowerCase().includes(q) && !items.some((i) => i.item === x.key)).slice(0, 6);
  }, [query, catalog, items]);

  const setQty = (key: string, delta: number) =>
    setItems((list) =>
      list.flatMap((i) => {
        if (i.item !== key) return [i];
        const q = i.quantity + delta;
        return q < 1 ? [] : [{ ...i, quantity: Math.min(q, 99) }];
      }),
    );

  async function save() {
    if (!api) return;
    setSaving(true);
    try {
      await api.saveBasket(items);
      setMessage("Saved");
      await reload();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <Screen><Loading /></Screen>;

  return (
    <Screen>
      <Title>Usual items</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i.item}
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            <View>
              <Text variant="bodyMedium" style={{ color: c.muted, marginBottom: 8 }}>
                {data ? SOURCE_NOTE[data.basket.source] : ""} Quantities are packs of the size shown.
              </Text>
              <Searchbar placeholder="Add an item" accessibilityLabel="Search items to add" value={query} onChangeText={setQuery} />
              {matches.map((m) => (
                <List.Item
                  key={m.key}
                  title={m.name}
                  description={m.reference_pack}
                  left={(p) => <List.Icon {...p} icon="plus-circle-outline" />}
                  onPress={() => {
                    setItems((l) => [...l, { item: m.key, quantity: 1 }]);
                    setQuery("");
                  }}
                  accessibilityLabel={`Add ${m.name}`}
                />
              ))}
              {error ? <HelperText type="error" visible>{error}</HelperText> : null}
            </View>
          }
          ListEmptyComponent={<Body muted>Nothing yet. Search above to add items.</Body>}
          renderItem={({ item }) => (
            <Card>
              <View style={{ flexDirection: "row", alignItems: "center" }}>
                <View style={{ flex: 1 }}>
                  <Body bold>{nameOf(item.item)}</Body>
                  <Text variant="bodySmall" style={{ color: c.muted }}>{packOf(item.item)}</Text>
                </View>
                <IconButton icon="minus" onPress={() => setQty(item.item, -1)} accessibilityLabel={`Fewer ${nameOf(item.item)}`} />
                <Text variant="titleMedium" style={{ minWidth: 24, textAlign: "center" }}>{item.quantity}</Text>
                <IconButton icon="plus" onPress={() => setQty(item.item, 1)} accessibilityLabel={`More ${nameOf(item.item)}`} />
              </View>
            </Card>
          )}
          ListFooterComponent={
            <View style={{ marginVertical: 12 }}>
              <Button label={saving ? "Saving…" : "Save my list"} icon="content-save-outline" onPress={save} disabled={saving} />
              {message ? <HelperText type={message === "Saved" ? "info" : "error"} visible>{message}</HelperText> : null}
            </View>
          }
        />
      )}
    </Screen>
  );
}
