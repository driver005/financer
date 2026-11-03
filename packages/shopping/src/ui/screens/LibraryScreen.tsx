import { useCallback, useEffect, useState } from "react";

import { Banner, Button, Chip, ChipRow, EmptyState, Grid, IconButton, ProductCard, ProductCardSkeletonList, Screen, Stack, Text, TopBar } from "@financer/ui";

import { ShopApiError } from "../../api/client";
import type { CategoryItem, Offer, Product } from "../../api/types";
import { useNav } from "../nav";
import { useShop } from "../runtime";

const PAGE = 24;

/** The cheapest offer that can be bought now, else the cheapest at all. */
function cheapest(p: Product): Offer | undefined {
  const cost = (o: Offer) => (o.recurring ? o.recurring.monthly_cents : o.price_cents);
  const sorted = [...p.offers].sort((a, b) => cost(a) - cost(b));
  return sorted.find((o) => o.in_stock !== false) ?? sorted[0];
}

/** Every product the app knows (found by searches or added by hand), by category. */
export function LibraryScreen({ category: initial }: { category?: string }) {
  const { client } = useShop();
  const nav = useNav();
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [category, setCategory] = useState<string | undefined>(initial);
  const [items, setItems] = useState<Product[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => void client?.categories().then(setCategories).catch(() => {}), [client]);

  const load = useCallback(
    async (append: boolean, from: number) => {
      if (!client) return;
      try {
        const page = await client.products(category, PAGE, from);
        setItems((cur) => (append && cur ? [...cur, ...page] : page));
        setMore(page.length === PAGE);
        setError(null);
      } catch (e) {
        setError(e instanceof ShopApiError ? e.message : "Could not load the products.");
      }
    },
    [client, category],
  );
  useEffect(() => {
    setItems(null);
    void load(false, 0);
  }, [load]);

  return (
    <Screen
      header={<TopBar title="My products" subtitle="Found by searches or added by you" onBack={nav.pop} actions={<IconButton icon="plus" label="Add a product" variant="soft" tone="accent" onPress={() => nav.push({ name: "addProduct", category })} />} />}
    >
      {error ? <Banner tone="danger" action={<Button label="Try again" variant="outline" tone="neutral" size="sm" onPress={() => void load(false, 0)} />}>{error}</Banner> : null}
      {categories.length > 1 ? (
        <ChipRow>
          <Chip label="All" selected={category === undefined} onPress={() => setCategory(undefined)} />
          {categories.map((c) => <Chip key={c.id} label={c.name} selected={category === c.id} onPress={() => setCategory(c.id)} />)}
        </ChipRow>
      ) : null}
      {items === null && !error ? (
        <ProductCardSkeletonList count={4} />
      ) : items && items.length === 0 ? (
        <EmptyState
          icon="package-variant-closed"
          title="No products yet"
          message="Searches fill this list. You can also add a product you know about, with its price and specs."
          action={<Button label="Add a product" icon="plus" onPress={() => nav.push({ name: "addProduct", category })} />}
        />
      ) : (
        <Stack gap="lg">
          <Grid columns={{ base: 1, md: 2 }}>
            {(items ?? []).map((p) => {
              const o = cheapest(p);
              return (
                <ProductCard
                  key={p.id}
                  layout="row"
                  title={p.title}
                  brand={p.brand}
                  imageUri={p.image}
                  priceCents={o ? (o.recurring ? o.recurring.monthly_cents : o.price_cents) : null}
                  perMonth={Boolean(o?.recurring)}
                  shop={o ? o.shop : "No price yet"}
                  badges={[{ label: p.category.replace(/_/g, " ") }]}
                  onPress={() => nav.push({ name: "product", id: p.id })}
                />
              );
            })}
          </Grid>
          {more ? <Button label="Show more" variant="outline" tone="neutral" onPress={() => void load(true, items?.length ?? 0)} /> : null}
          {items && items.length > 0 ? <Text variant="caption" tone="muted" align="center">{`${items.length} shown`}</Text> : null}
        </Stack>
      )}
    </Screen>
  );
}
