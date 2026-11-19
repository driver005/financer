import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import {
  AsyncBoundary, Badge, Box, Button, Card, Chip, FadeIn, FgHeaderIcon, FgScreen,
  Segmented, Sheet, Text, TextField,
} from "@finance/ui";
import { fgEuro } from "@finance/ui";
import { loadPriceComparison, saveItemPrice, storeColor, type ComparedItem } from "../lib/prices";
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
  const [expanded, setExpanded] = useState<string | null>(null);
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

  const items = useMemo(() => {
    const list = (data?.items ?? []).filter((item) => item.name.toLowerCase().includes(query.toLowerCase()));
    return sort === "saving"
      ? [...list].sort((a, b) => b.savingCents - a.savingCents || a.name.localeCompare(b.name))
      : [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [data, query, sort]);

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
              <Text variant="body4" color="muted">{`${data.items.length} items · ${data.stores.length} discounters · ${data.offerCount} offers · ${data.items.reduce((n, i) => n + i.quotes.filter((q) => q.onSale).length, 0)} sales`}</Text>
              <TextField label="Search" value={query} onChangeText={setQuery} placeholder="e.g. Milk, Coffee, pasta" />
              <Segmented value={sort} onChange={setSort} options={[{ value: "saving", label: "Biggest saving" }, { value: "name", label: "A–Z" }]} />
            </Card>
          </FadeIn>
          {items.map((item, index) => (
            <FadeIn key={item.name} delay={Math.min(index * 30, 180)}>
              <FgItemCard item={item} expanded={expanded === item.name} onToggle={() => setExpanded(expanded === item.name ? null : item.name)} router={router} />
            </FadeIn>
          ))}
          {!items.length ? (
            <Card>
              <Text variant="heading5">No price data yet</Text>
              <Text variant="body3" color="muted">Add a price for an item at a discounter, or import receipts under Shops & offers.</Text>
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
        <Box row gap={8} style={{ flexWrap: "wrap" }}>
          {(data?.stores ?? []).map((store) => (
            <Chip key={store.id} label={store.name} selected={storeId === store.id} onPress={() => setStoreId(store.id)} />
          ))}
        </Box>
        <Button label="Save price" icon="check" onPress={() => void save()} />
      </Sheet>
    </FgScreen>
  );
}

function FgItemCard({ item, expanded, onToggle, router }: {
  item: ComparedItem; expanded: boolean; onToggle: () => void; router: ReturnType<typeof useRouter>;
}) {
  return (
    <Card>
      <Box row gap={12} style={{ alignItems: "center" }}>
        <Box style={{ width: 42, height: 42, borderRadius: 12, backgroundColor: "#EFE7FB", alignItems: "center", justifyContent: "center" }}>
          <Text variant="body2">{item.name.slice(0, 1).toUpperCase()}</Text>
        </Box>
        <Box style={{ flex: 1, gap: 3 }}>
          <Text variant="heading5">{item.name}</Text>
          <Text variant="caption" color="muted">{`Best at ${item.bestStore || "—"} · ${item.quotes.length} prices`}</Text>
          <Box row gap={6}>
            {item.hasSale ? <Badge label="Sale" tone="offer" /> : null}
            {item.savingCents > 0 ? <Badge label={`Save ${fgEuro(item.savingCents, false)}`} tone="income" /> : null}
          </Box>
        </Box>
        <Box style={{ alignItems: "flex-end" }}>
          <Text variant="numericTitle" color="primary">{fgEuro(item.bestCents)}</Text>
          <Text variant="body5" color="muted">lowest</Text>
        </Box>
      </Box>
      <Button label={expanded ? "Hide prices" : `Compare ${item.quotes.length} prices`} variant="secondary" onPress={onToggle} />
      {expanded ? (
        <Box gap={8}>
          {item.quotes.map((quote) => (
            <Box key={quote.storeId} row gap={10} style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: "#E5E5E5" }}>
              <Box style={{ width: 34, height: 34, borderRadius: 9, backgroundColor: storeColor(quote.storeId), alignItems: "center", justifyContent: "center" }}>
                <Text variant="body4" style={{ color: "#FFFFFF", fontWeight: "700" }}>{quote.storeName.slice(0, 1)}</Text>
              </Box>
              <Box style={{ flex: 1, gap: 2 }}>
                <Box row gap={6} style={{ alignItems: "center" }}>
                  <Text variant="body3">{quote.storeName}</Text>
                  {quote.cents === item.bestCents ? <Badge label="Cheapest" tone="income" /> : null}
                  {quote.onSale ? <Badge label={quote.offer?.note || "Sale"} tone="offer" /> : null}
                </Box>
                <Text variant="caption" color="muted">
                  {`avg ${fgEuro(quote.avgCents)} · ${quote.samples} prices${quote.buyNow ? " · buy now" : ` · wait for ${quote.nextDate}`}`}
                </Text>
              </Box>
              <Text variant="numericMedium">{fgEuro(quote.cents)}</Text>
            </Box>
          ))}
          <Button label="Open shopping list" variant="tertiary" onPress={() => router.push("/list")} />
        </Box>
      ) : null}
    </Card>
  );
}
