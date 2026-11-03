import { useEffect, useMemo, useState } from "react";
import { Box, Button, Card, Group, HeroCaption, HeroCard, HeroChip, HeroNumber, IconBadge, ListItem, Note, Row, SearchBar, Snackbar, Stepper, Text, VirtualList } from "@financer/ui";

import type { BasketItem, CatalogItem } from "@/api/client";
import { useApi } from "@/api/config";
import { Page } from "@/components/Page";
import { SectionSwitch } from "@/components/SectionSwitch";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { initials, mealTone } from "@/groceryView";
import { useScreenData } from "@/hooks";

const SOURCE_NOTE: Record<string, string> = {
  manual: "Your own list.",
  receipts: "Learned from your receipts. Editing here switches nothing; set the habit mode in Settings.",
  starter: "A generic starter basket. Save your own list to replace it.",
};

export default function BasketScreen() {
  const { api, loaded } = useApi();
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

  if (!loaded) return <Page title="Usual items"><Loading /></Page>;
  if (!api) return <Page title="Usual items"><SectionSwitch /><NeedsSetup /></Page>;

  const loading = !data && !error;

  return (
    <Page
      title="Usual items"
      fixed
      footer={
        <Box p="lg" gap="sm" bg="surface">
          <Button label={saving ? "Saving…" : "Save my list"} icon="content-save-outline" onPress={save} disabled={saving} />
          {message && message !== "Saved" ? <Note tone="error">{message}</Note> : null}
          <Snackbar visible={message === "Saved"} onDismiss={() => setMessage(null)}>Saved</Snackbar>
        </Box>
      }
    >
      <VirtualList
        data={items}
        keyExtractor={(i) => i.item}
        header={
          <Box gap="md">
            <SectionSwitch />
            {data ? (
              <HeroCard label="Usual items" chip={<HeroChip icon="cart-outline" text="Compared across chains" />}>
                <HeroNumber value={`${items.length}`} suffix={items.length === 1 ? "item" : "items"} />
                <HeroCaption>{`${SOURCE_NOTE[data.basket.source]} Quantities are packs of the size shown.`}</HeroCaption>
              </HeroCard>
            ) : null}
            <SearchBar placeholder="Add an item" value={query} onChangeText={setQuery} />
            {matches.length > 0 ? (
              <Group>
                {matches.map((m) => (
                  <ListItem
                    key={m.key}
                    icon="plus-circle"
                    title={m.name}
                    subtitle={m.reference_pack}
                    label={`Add ${m.name}`}
                    onPress={() => {
                      setItems((l) => [...l, { item: m.key, quantity: 1 }]);
                      setQuery("");
                    }}
                  />
                ))}
              </Group>
            ) : null}
            {error ? <Note tone="error">{error}</Note> : null}
            {loading ? <Loading rows={3} /> : null}
          </Box>
        }
        empty={
          loading ? undefined : (
            <Empty title="Nothing on your list yet" message="Search above for what you buy most. Financer compares these items across Aldi, Lidl, Kaufland and Rewe." />
          )
        }
        renderItem={(item) => (
          <Card>
            <Row gap="md">
              <IconBadge tone={mealTone(item.item)} text={initials(nameOf(item.item))} square />
              <Box grow>
                <Text variant="bodyStrong" numberOfLines={2}>{nameOf(item.item)}</Text>
                <Text variant="caption" tone="muted">{packOf(item.item)}</Text>
              </Box>
              <Stepper
                value={item.quantity}
                remove={item.quantity === 1}
                onMinus={() => setQty(item.item, -1)}
                onPlus={() => setQty(item.item, 1)}
                minusLabel={item.quantity === 1 ? `Remove ${nameOf(item.item)}` : `Fewer ${nameOf(item.item)}`}
                plusLabel={`More ${nameOf(item.item)}`}
              />
            </Row>
          </Card>
        )}
      />
    </Page>
  );
}
