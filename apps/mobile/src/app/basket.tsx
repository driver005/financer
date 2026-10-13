import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useEffect, useMemo, useState } from "react";
import { FlatList, Text as RNText, View } from "react-native";

import type { BasketItem, CatalogItem } from "@/api/client";
import { useApi } from "@/api/config";
import { Avatar, EmptyState, Group, Panel, SectionLabel, SkeletonCards, Stepper, Subtitle, Tap, space } from "@/components/grocery/primitives";
import { ChunkyButton, HelperText, Searchbar, Text } from "@/components/kit";
import { Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import { initials, mealTint } from "@/groceryView";
import { useScreenData } from "@/hooks";
import { usePalette } from "@/theme";

const SOURCE_NOTE: Record<string, string> = {
  manual: "Your own list.",
  receipts: "Learned from your receipts. Editing here switches nothing; set the habit mode in Settings.",
  starter: "A generic starter basket. Save your own list to replace it.",
};

export default function BasketScreen() {
  const { api, loaded } = useApi();
  const p = usePalette();
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

  const loading = !data && !error;

  return (
    <Screen>
      <Title>Usual items</Title>
      {api ? <Subtitle>What you buy again and again. Prices are compared for these.</Subtitle> : null}
      {!api ? (
        <NeedsSetup />
      ) : (
        <View style={{ flex: 1 }}>
          <FlatList
            data={items}
            keyExtractor={(i) => i.item}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: space.lg }}
            ListHeaderComponent={
              <View>
                {data ? (
                  <View style={{ flexDirection: "row", gap: space.sm, marginBottom: space.md }}>
                    <MaterialCommunityIcons name="information-outline" size={18} color={p.muted} style={{ marginTop: 2 }} />
                    <Text variant="bodyMedium" style={{ color: p.muted, flex: 1 }}>
                      {SOURCE_NOTE[data.basket.source]} Quantities are packs of the size shown.
                    </Text>
                  </View>
                ) : null}
                <Searchbar placeholder="Add an item" accessibilityLabel="Search items to add" value={query} onChangeText={setQuery} />
                {matches.length > 0 ? (
                  <View style={{ marginTop: space.md }}>
                    <Group>
                      {matches.map((m) => (
                        <Tap
                          key={m.key}
                          accessibilityLabel={`Add ${m.name}`}
                          onPress={() => {
                            setItems((l) => [...l, { item: m.key, quantity: 1 }]);
                            setQuery("");
                          }}
                          style={{ flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm, minHeight: 56 }}
                        >
                          <MaterialCommunityIcons name="plus-circle" size={26} color={p.accent} />
                          <View style={{ flex: 1 }}>
                            <RNText style={{ color: p.text, fontSize: 16, fontWeight: "600" }}>{m.name}</RNText>
                            <RNText style={{ color: p.muted, fontSize: 13 }}>{m.reference_pack}</RNText>
                          </View>
                        </Tap>
                      ))}
                    </Group>
                  </View>
                ) : null}
                {error ? <HelperText type="error" visible>{error}</HelperText> : null}
                {loading ? <SkeletonCards count={3} label="Loading your usual items" /> : null}
                {items.length > 0 ? <SectionLabel>{`${items.length} item${items.length === 1 ? "" : "s"}`}</SectionLabel> : <View style={{ height: space.md }} />}
              </View>
            }
            ListEmptyComponent={
              loading ? undefined : (
                <EmptyState
                  title="Nothing on your list yet"
                  body="Search above for what you buy most. Financer compares these items across Aldi, Lidl, Kaufland and Rewe."
                />
              )
            }
            renderItem={({ item }) => (
              <Panel padding={space.md} style={{ marginBottom: space.sm }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: space.md }}>
                  <Avatar tint={mealTint(item.item)} label={initials(nameOf(item.item))} size={44} square />
                  <View style={{ flex: 1 }}>
                    <RNText style={{ color: p.text, fontSize: 16, fontWeight: "700" }} numberOfLines={2}>
                      {nameOf(item.item)}
                    </RNText>
                    <RNText style={{ color: p.muted, fontSize: 13 }}>{packOf(item.item)}</RNText>
                  </View>
                  <Stepper
                    value={item.quantity}
                    minusIcon={item.quantity === 1 ? "delete-outline" : "minus"}
                    onMinus={() => setQty(item.item, -1)}
                    onPlus={() => setQty(item.item, 1)}
                    minusLabel={item.quantity === 1 ? `Remove ${nameOf(item.item)}` : `Fewer ${nameOf(item.item)}`}
                    plusLabel={`More ${nameOf(item.item)}`}
                  />
                </View>
              </Panel>
            )}
          />
          <View style={{ paddingTop: space.sm, paddingBottom: space.sm }}>
            <ChunkyButton label={saving ? "Saving…" : "Save my list"} icon="content-save-outline" onPress={save} disabled={saving} />
            {message ? <HelperText type={message === "Saved" ? "info" : "error"} visible>{message}</HelperText> : null}
          </View>
        </View>
      )}
    </Screen>
  );
}
