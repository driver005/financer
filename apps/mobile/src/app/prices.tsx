import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  AsyncBoundary, Badge, Box, Button, Card, Chip, FadeIn, FgHeaderIcon, FgScreen,
  Segmented, Sheet, Text, TextField,
} from "@finance/ui";
import { fgEuro } from "@finance/ui";
import { loadPriceComparison, saveItemPrice, type ComparedItem } from "../lib/prices";
import { parseEuro } from "../lib/money";

type Data = Awaited<ReturnType<typeof loadPriceComparison>>;

export default function PricesScreen() {
  const router = useRouter();
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"saving" | "name">("saving");
  const [open, setOpen] = useState(false);
  const [itemName, setItemName] = useState("");
  const [storeId, setStoreId] = useState("");
  const [price, setPrice] = useState("");

  const load = () => {
    setLoading(true);
    void loadPriceComparison()
      .then((d) => {
        setData(d);
        if (d.stores.length && !storeId) setStoreId(d.stores[0].id);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load local prices"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const items = (data?.items ?? []).filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
  const sorted = sort === "saving"
    ? [...items].sort((a, b) => b.savingCents - a.savingCents || a.name.localeCompare(b.name))
    : [...items].sort((a, b) => a.name.localeCompare(b.name));

  const save = async () => {
    const cents = parseEuro(price);
    if (!itemName || !storeId || cents === null) return;
    await saveItemPrice(itemName.trim(), storeId, cents);
    setOpen(false); setPrice(""); load();
  };

  return (
    <FgScreen
      title="Prices"
      actions={<>
        <FgHeaderIcon name="view-grid" label="All apps" onPress={() => router.push("/hub")} />
        <FgHeaderIcon name="plus" label="Add price" onPress={() => setOpen(true)} />
      </>}
    >
      <AsyncBoundary loading={loading} error={error} onRetry={load} rows={5}>
        {data && <>
          <FadeIn>
            <Card>
              <Text variant="body4" color="muted">{`${data.items.length} items · ${data.stores.length} discounters`}</Text>
              <TextField label="Search" value={query} onChangeText={setQuery} placeholder="e.g. Milk, Coffee, pasta" />
              <Segmented value={sort} onChange={setSort} options={[
                { value: "saving", label: "Biggest saving" }, { value: "name", label: "A–Z" },
              ]} />
              <Text variant="body5" color="muted">Tap an item for its full price history and all discounters.</Text>
            </Card>
          </FadeIn>
          {sorted.map((item, index) => (
            <FadeIn key={item.name} delay={Math.min(index * 30, 150)}>
              <ItemRow item={item} onPress={() => router.push(`/price-detail?item=${encodeURIComponent(item.name)}`)} />
            </FadeIn>
          ))}
          {!sorted.length ? (
            <Card>
              <Text variant="heading5">No prices yet</Text>
              <Text variant="body3" color="muted">Add a price and the comparison chart will appear here.</Text>
              <Button label="Add first price" icon="plus" onPress={() => setOpen(true)} />
            </Card>
          ) : null}
        </>}
      </AsyncBoundary>

      <Sheet visible={open} onClose={() => setOpen(false)} title="Add a price">
        <Text variant="body4" color="muted">Prices are stored locally and compared across all discounters.</Text>
        <TextField label="Item" value={itemName} onChangeText={setItemName} placeholder="e.g. Milk" />
        <TextField label="Price" value={price} onChangeText={setPrice} numeric placeholder="e.g. 1,29" />
        <Text variant="body4" color="muted">Store</Text>
        <Box row gap={10} style={{ flexWrap: "wrap" }}>
          {(data?.stores ?? []).map((store) => (
            <Chip key={store.id} label={store.name} selected={storeId === store.id} onPress={() => setStoreId(store.id)} />
          ))}
        </Box>
        <Button label="Save price" icon="check" onPress={() => void save()} />
      </Sheet>
    </FgScreen>
  );
}

function ItemRow({ item, onPress }: { item: ComparedItem; onPress: () => void }) {
  return (
    <Card style={{ gap: 12 }}>
      <Box row gap={12} style={{ alignItems: "center" }}>
        <Box style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: "#D7FFB8", alignItems: "center", justifyContent: "center" }}>
          <Text variant="heading5" color="primary">{item.name.slice(0, 1).toUpperCase()}</Text>
        </Box>
        <Box style={{ flex: 1, gap: 4 }}>
          <Text variant="heading5">{item.name}</Text>
          <Text variant="caption" color="muted">{`Best at ${item.bestStore || "—"} · ${item.quotes.length} prices`}</Text>
          <Box row gap={6} style={{ flexWrap: "wrap" }}>
            {item.hasSale ? <Badge label="Sale" tone="offer" /> : null}
            {item.savingCents > 0 ? <Badge label={`Save ${fgEuro(item.savingCents, false)}`} tone="income" /> : null}
          </Box>
        </Box>
        <Box style={{ alignItems: "flex-end" }}>
          <Text variant="numericTitle" color="primary">{fgEuro(item.bestCents)}</Text>
          <Text variant="body5" color="muted">lowest</Text>
        </Box>
      </Box>
      <Button label="View price history" variant="secondary" onPress={onPress} />
    </Card>
  );
}
