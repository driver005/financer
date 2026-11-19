import React, { useEffect, useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
  AsyncBoundary, Badge, Box, Button, Card, Chip, FadeIn, FgHeaderIcon, FgScreen,
  PriceHistoryChart, Sheet, Text, TextField,
} from "@finance/ui";
import { fgEuro } from "@finance/ui";
import { loadPriceComparison, saveItemPrice, savePriceSnapshot, storeColor, type ComparedItem } from "../lib/prices";
import { parseEuro } from "../lib/money";

/** Own full page for one item: history chart, every discounter, save actions. */
export default function PriceDetailScreen() {
  const router = useRouter();
  const { item: rawName } = useLocalSearchParams<{ item: string }>();
  const name = decodeURIComponent(rawName ?? "");
  const [data, setData] = useState<Awaited<ReturnType<typeof loadPriceComparison>> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
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
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load price history"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const item = data?.items.find((i) => i.name.toLowerCase() === name.toLowerCase());

  const save = async () => {
    const cents = parseEuro(price);
    if (cents === null) return;
    await saveItemPrice(name, storeId, cents);
    setOpen(false); setPrice(""); load();
  };

  return (
    <FgScreen
      title={name || "Price details"}
      actions={<FgHeaderIcon name="view-grid" label="All apps" onPress={() => router.push("/hub")} />}
    >
      <Button label="Back to prices" variant="tertiary" icon="arrow-left" onPress={() => router.push("/prices")} />
      <AsyncBoundary loading={loading} error={error} onRetry={load} rows={5}>
        {item ? <PriceDetailBody item={item} onAdd={() => setOpen(true)}
          onSnapshot={() => void savePriceSnapshot(item.name, item.quotes.map((q) => ({ storeId: q.storeId, cents: q.cents }))).then(load)}
          onList={() => router.push("/list")} /> : (
          <Card>
            <Text variant="heading5">Item not found</Text>
            <Text variant="body3" color="muted">This item has no saved prices yet.</Text>
          </Card>
        )}
      </AsyncBoundary>

      <Sheet visible={open} onClose={() => setOpen(false)} title={`Add price · ${name}`}>
        <Text variant="body4" color="muted">Save today's price at a discounter to grow the history chart.</Text>
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

function PriceDetailBody({ item, onAdd, onSnapshot, onList }: {
  item: ComparedItem; onAdd: () => void; onSnapshot: () => void; onList: () => void;
}) {
  return (
    <>
      <FadeIn>
        <Card style={{ borderColor: paletteGreen, backgroundColor: "#F3FFE8" }}>
          <Text variant="caption" color="muted">Best price today</Text>
          <Box row style={{ justifyContent: "space-between", alignItems: "flex-end" }}>
            <Text variant="numericHeading" color="primary">{fgEuro(item.bestCents)}</Text>
            <Text variant="body3" color="muted">{`at ${item.bestStore || "—"}`}</Text>
          </Box>
          <Box row gap={8} style={{ marginTop: 8 }}>
            {item.hasSale ? <Badge label="On sale" tone="offer" /> : null}
            {item.savingCents > 0 ? <Badge label={`Save ${fgEuro(item.savingCents, false)}`} tone="income" /> : null}
            <Badge label={`${item.quotes.length} stores`} tone="muted" />
          </Box>
        </Card>
      </FadeIn>
      <FadeIn delay={60}>
        <PriceHistoryChart series={item.series} title={`${item.name} · all stores`} />
      </FadeIn>
      <FadeIn delay={120}>
        <Card>
          <Text variant="heading5">All discounters</Text>
          {item.quotes.map((quote) => (
            <Box key={quote.storeId} row gap={12} style={{ paddingVertical: 12, borderBottomWidth: 2, borderBottomColor: "#F0F0F0" }}>
              <Box style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: storeColor(quote.storeId), alignItems: "center", justifyContent: "center" }}>
                <Text variant="body4" style={{ color: "#FFFFFF", fontWeight: "800" }}>{quote.storeName.slice(0, 1)}</Text>
              </Box>
              <Box style={{ flex: 1, gap: 3 }}>
                <Box row gap={6} style={{ alignItems: "center" }}>
                  <Text variant="heading6">{quote.storeName}</Text>
                  {quote.cents === item.bestCents ? <Badge label="Cheapest" tone="income" /> : null}
                  {quote.onSale ? <Badge label={quote.offer?.note || "Sale"} tone="offer" /> : null}
                </Box>
                <Text variant="caption" color="muted">{`avg ${fgEuro(quote.avgCents)} · ${quote.samples} saved prices`}</Text>
                <Text variant="caption" color={quote.buyNow ? "income" : "muted"}>{quote.buyNow ? "Buy now" : `Wait for ${quote.nextDate}`}</Text>
              </Box>
              <Text variant="numericMedium">{fgEuro(quote.cents)}</Text>
            </Box>
          ))}
        </Card>
      </FadeIn>
      <FadeIn delay={180}>
        <Box gap={12}>
          <Button label="Save today's prices" icon="content-save" onPress={onSnapshot} />
          <Button label="Add a price" icon="plus" variant="secondary" onPress={onAdd} />
          <Button label="Add to shopping list" icon="cart" variant="tertiary" onPress={onList} />
        </Box>
      </FadeIn>
    </>
  );
}

const paletteGreen = "#58CC02";
