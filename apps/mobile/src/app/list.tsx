import React, { useCallback, useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { Badge, Button, Card, Checkbox, Empty, IconButton, Loading, Note, Screen, SectionTitle, Segmented, Text, TextField } from "../ui/primitives";
import { tokens } from "../ui/theme";
import { addShoppingItem, clearChecked, removeShoppingItem, shoppingList, toggleShoppingItem } from "../db/shopping";
import { getStores, offers } from "../db/money";
import { purchases } from "../db/purchases";
import { core } from "../rust/core";
import type { Scope, ShoppingItem, Store } from "../lib/types";

export default function ListScreen() {
  const router = useRouter();
  const [scope, setScope] = useState<Scope>("week");
  const [period, setPeriod] = useState(() => core.periodKey("week", new Date()));
  const [items, setItems] = useState<ShoppingItem[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [qty, setQty] = useState("1");
  const [store, setStore] = useState("");
  const [selectedStores, setSelectedStores] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setItems(await shoppingList(scope, period));
    setLoading(false);
  }, [scope, period]);

  useEffect(() => { void getStores().then(setStores); }, []);
  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const changeScope = (next: Scope) => {
    setScope(next);
    setPeriod(core.periodKey(next, new Date()));
  };

  const add = useCallback(async () => {
    if (!name.trim()) return;
    await addShoppingItem({ name: name.trim(), qty: qty.trim() || "1", scope, period, store, recipeId: null });
    setName("");
    setQty("1");
    await load();
  }, [name, qty, scope, period, store, load]);

  const generateFromBrands = useCallback(async () => {
    if (!selectedStores.length) { setMessage("Select at least one brand first."); return; }
    const [bought, offerRows] = await Promise.all([purchases(), offers()]);
    const chosen = bought.filter((item) => selectedStores.includes(item.storeId));
    if (!chosen.length) { setMessage("No saved items for those brands. Add them under Shops → What I buy here."); return; }
    const generated = core.buildList(
      chosen.map((item) => ({ storeId: item.storeId, name: item.name, qty: item.qty })),
      offerRows,
      scope,
    );
    for (const row of generated) {
      await addShoppingItem({
        name: row.name, qty: row.qty, scope, period, store: row.store, recipeId: null,
        offerPrice: row.offerPrice ?? "", offerProduct: row.offerProduct ?? "",
      });
    }
    setMessage(`Generated ${generated.length} items from ${selectedStores.length} brand${selectedStores.length === 1 ? "" : "s"}.`);
    await load();
  }, [selectedStores, scope, period, load]);

  const toggleBrand = (id: string) => setSelectedStores((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const openCount = items.filter((item) => !item.checked).length;
  const byStore = stores
    .map((s) => ({ name: s.name, count: items.filter((i) => i.store === s.id && !i.checked).length }))
    .filter((row) => row.count > 0);

  return (
    <Screen
      title="Shopping list"
      subtitle={`${openCount} open · ${core.periodLabel(scope, period)}`}
      action={
        <View style={styles.actions}>
          <IconButton icon="chart-line" label="Best prices" onPress={() => router.push("/optimize")} />
          <IconButton icon="trash-can-outline" label="Clear checked" onPress={() => void clearChecked(scope, period).then(load)} />
        </View>
      }
    >
      <Segmented value={scope} onChange={changeScope} options={[{ value: "week", label: "Week" }, { value: "month", label: "Month" }]} />
      <View style={styles.period}>
        <IconButton icon="chevron-left" label="Previous period" onPress={() => setPeriod(core.shiftPeriod(scope, period, -1))} />
        <Text>{core.periodLabel(scope, period)}</Text>
        <IconButton icon="chevron-right" label="Next period" onPress={() => setPeriod(core.shiftPeriod(scope, period, 1))} />
      </View>

      <Card tone="accent">
        <SectionTitle>Generate from brands</SectionTitle>
        <Text variant="caption" color="muted">Build the list from what you usually buy at each supermarket. Items in an Angebot are marked automatically.</Text>
        <View style={styles.storeRow}>
          {stores.map((s) => (
            <Checkbox key={`brand-${s.id}`} checked={selectedStores.includes(s.id)} onPress={() => toggleBrand(s.id)} label={s.name} />
          ))}
        </View>
        <Button label="Generate list" icon="auto-fix" onPress={() => void generateFromBrands()} disabled={!selectedStores.length} />
        {message ? <Note tone="info">{message}</Note> : null}
      </Card>

      <Card>
        <SectionTitle>Add an item</SectionTitle>
        <TextField label="Item" value={name} onChangeText={setName} placeholder="e.g. Milk" />
        <TextField label="Amount" value={qty} onChangeText={setQty} />
        <Segmented
          value={store || "none"}
          onChange={setStore}
          options={[...stores.map((s) => ({ value: s.id, label: s.name })), { value: "none", label: "Any" }]}
        />
        <Button label="Add to list" onPress={() => void add()} disabled={!name.trim()} />
      </Card>

      {byStore.length ? (
        <View style={styles.storeRow}>
          {byStore.map((row) => <Badge key={row.name} label={`${row.name}: ${row.count}`} />)}
        </View>
      ) : null}

      {loading ? <Loading rows={3} /> : null}
      {!loading && !items.length ? (
        <Empty icon="format-list-checks" title="Empty list" message="Save a recipe and add its ingredients, or type an item above." />
      ) : null}
      {items.map((item) => (
        <Card key={item.id}>
          <View style={styles.row}>
            <Checkbox checked={!!item.checked} onPress={() => void toggleShoppingItem(item.id, !item.checked).then(load)} />
            <Pressable style={styles.grow} onPress={() => router.push({ pathname: "/item", params: { id: String(item.id) } })} accessibilityRole="button" accessibilityLabel={`Open prices for ${item.name}`}>
              <Text variant={item.checked ? "caption" : "body"}>{item.name}</Text>
              <Text variant="caption" color="muted">{item.qty}{item.store ? ` · ${stores.find((s) => s.id === item.store)?.name ?? item.store}` : ""}</Text>
              {item.offerPrice ? (
                <View style={styles.offer}>
                  <Badge label="ANGEBOT" tone="offer" />
                  <Text variant="caption" color="accent">{`${item.offerPrice}${item.offerProduct ? ` · ${item.offerProduct}` : ""}`}</Text>
                </View>
              ) : null}
            </Pressable>
            <IconButton icon="trash-can-outline" label={`Remove ${item.name}`} onPress={() => void removeShoppingItem(item.id).then(load)} />
          </View>
        </Card>
      ))}
      {items.length ? <Note tone="muted">Lists are per week or per month and stay on this device.</Note> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  period: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.sm },
  grow: { flex: 1, gap: 2 },
  storeRow: { flexDirection: "row", flexWrap: "wrap", gap: tokens.sm },
  offer: { flexDirection: "row", alignItems: "center", gap: tokens.xs, marginTop: 2 },
  actions: { flexDirection: "row", gap: tokens.xs },
});
