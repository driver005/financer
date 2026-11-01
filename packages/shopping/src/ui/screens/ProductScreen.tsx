import { useCallback, useEffect, useState } from "react";

import {
  Badge, Banner, Box, Button, Chip, ChipRow, DealBadge, EmptyState, ListItem, OfferRow, PriceHistory, PriceTag, ProductCardSkeletonList, Row, Screen, Section, Split, Stack, Text, TextField, Thumbnail, TopBar, Card, Divider, useLayout,
} from "@financer/ui";

import { ShopApiError } from "../../api/client";
import type { AttrValue, ProductDetail } from "../../api/types";
import { ago, dealLine, planTerms } from "../../logic/format";
import { cacheKey, parseCached, serialize } from "../../logic/offlineCache";
import { openLink } from "../links";
import { useNav } from "../nav";
import { useShop } from "../runtime";

function show(v: AttrValue, unit?: string | null): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.join(", ");
  return typeof v === "number" && unit ? `${v} ${unit}` : String(v);
}

export function ProductScreen({ id }: { id: string }) {
  const { client, host } = useShop();
  const nav = useNav();
  const { isExpanded } = useLayout();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const now = Math.floor(Date.now() / 1000);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const fresh = await client.product(id);
      setDetail(fresh);
      setSavedAt(null);
      setError(null);
      // keep the last good copy for when the server cannot be reached
      void host.storage.set(cacheKey(id), serialize(fresh, Math.floor(Date.now() / 1000))).catch(() => {});
    } catch (e) {
      const saved = e instanceof ShopApiError && e.status < 500 ? null : parseCached(await host.storage.get(cacheKey(id)).catch(() => null));
      if (saved) {
        setDetail(saved.detail);
        setSavedAt(saved.savedAt);
      } else {
        setError(e instanceof ShopApiError ? e.message : "Could not load the product.");
      }
    }
  }, [client, host, id]);
  useEffect(() => void load(), [load]);

  const addSpec = async () => {
    if (!client || !key.trim() || !value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await client.editProduct(id, { attributes: { [key.trim()]: value.trim() } });
      setKey("");
      setValue("");
      await load();
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  if (!detail) {
    return (
      <Screen header={<TopBar title="Product" onBack={nav.pop} />}>
        {error ? <Banner tone="danger" action={<Button label="Try again" variant="outline" tone="neutral" size="sm" onPress={() => { setError(null); void load(); }} />}>{error}</Banner> : <ProductCardSkeletonList count={2} />}
      </Screen>
    );
  }
  const { product, deal, history, schema } = detail;
  const offers = [...product.offers].sort((a, b) => a.price_cents + (a.recurring?.monthly_cents ?? 0) - (b.price_cents + (b.recurring?.monthly_cents ?? 0)));
  const monthly = offers.some((o) => o.recurring);
  const best = offers.find((o) => o.in_stock !== false) ?? offers[0];
  const defs = new Map((schema.attributes ?? []).map((a) => [a.key, a]));
  const specKeys = Object.keys(product.attributes).sort((a, b) => (defs.has(b) ? 1 : 0) - (defs.has(a) ? 1 : 0) || a.localeCompare(b));

  return (
    <Screen header={<TopBar title={product.title} subtitle={product.brand ?? undefined} onBack={nav.pop} />}>
      {savedAt !== null ? (
        <Banner tone="warning" title="Offline" action={<Button label="Try again" variant="outline" tone="neutral" size="sm" onPress={() => void load()} />}>
          {`Showing the last prices we saved, ${ago(savedAt, now)}.`}
        </Banner>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      <Split>
        <Thumbnail uri={product.image} dim="thumb-lg" label={product.title} />
        <Box grow gap="md">
          <PriceTag
            cents={best ? (best.recurring ? best.recurring.monthly_cents : best.price_cents) : null}
            perMonth={Boolean(best?.recurring)}
            wasCents={best && !best.recurring ? best.list_price_cents : null}
            size="lg"
          />
          <Row gap="sm" wrap>
            {deal ? <DealBadge verdict={deal.verdict} discountPct={deal.discount_pct} /> : null}
            <Badge label={product.category.replace(/_/g, " ")} />
          </Row>
          {deal ? <Text variant="caption" tone="muted">{dealLine(deal)}</Text> : null}
          <Row gap="sm" wrap>
            {best?.url ? <Button label="Open in shop" icon="open-in-new" onPress={() => void openLink(best.url)} /> : null}
            <Button label="Tell me about deals" variant="soft" icon="bell-plus-outline" onPress={() => nav.push({ name: "watch", query: product.title, category: product.category })} />
          </Row>
        </Box>
      </Split>

      <Section title={monthly ? "Plans and prices" : "Where to buy"}>
        {offers.length === 0 ? (
          <EmptyState icon="tag-off-outline" title="No price yet" message="Build the index for a search that finds this product." />
        ) : (
          <Card padded={false}>
            <Box px="lg">
              {offers.map((o, i) => (
                <Box key={`${o.shop}${o.url}${o.condition}`}>
                  {i > 0 ? <Divider /> : null}
                  <OfferRow
                    shop={o.shop}
                    priceCents={o.recurring ? o.recurring.monthly_cents : o.price_cents}
                    perMonth={Boolean(o.recurring)}
                    wasCents={o.recurring ? null : o.list_price_cents}
                    detail={[o.recurring ? planTerms(o) : null, o.condition && o.condition !== "new" ? o.condition : null, o.seen_at ? `seen ${ago(o.seen_at, now)}` : null].filter(Boolean).join(" · ")}
                    inStock={o.in_stock !== false}
                    best={o === best && offers.length > 1}
                    onOpen={() => void openLink(o.url)}
                  />
                </Box>
              ))}
            </Box>
          </Card>
        )}
      </Section>

      <Section title="Price history">
        <PriceHistory cents={history.map((h) => h.cents)} perMonth={monthly} />
      </Section>

      <Section title="Specifications">
        <Card padded={false}>
          {specKeys.length === 0 ? <Box p="lg"><Text variant="body" tone="muted">No specs known yet. Add the ones you know below.</Text></Box> : null}
          <Row align="start">
            {(isExpanded ? [specKeys.slice(0, Math.ceil(specKeys.length / 2)), specKeys.slice(Math.ceil(specKeys.length / 2))] : [specKeys]).map((keys, col) => (
              <Box key={col} equal px="lg">
                {keys.map((k, i) => {
                  const def = defs.get(k);
                  return (
                    <Box key={k}>
                      {i > 0 ? <Divider /> : null}
                      <ListItem title={def?.label ?? k.replace(/_/g, " ")} trailing={<Text variant="number" align="right">{show(product.attributes[k], def?.unit)}</Text>} />
                    </Box>
                  );
                })}
              </Box>
            ))}
          </Row>
        </Card>
      </Section>

      <Section card title="Add or correct a spec" description="Your own facts count in the ranking and survive later crawls. Any name works; names the category knows are used by its criteria.">
        <Stack gap="md">
          <ChipRow>
            {(schema.attributes ?? []).filter((a) => !(a.key in product.attributes)).slice(0, 8).map((a) => (
              <Chip key={a.key} label={a.label} selected={key === a.key} onPress={() => setKey(a.key)} />
            ))}
          </ChipRow>
          <TextField label="Name" value={key} onChangeText={setKey} placeholder="camera_score" />
          <TextField label="Value" value={value} onChangeText={setValue} placeholder="92 or 5000 mAh or yes" />
          <Row><Button label="Save spec" onPress={() => void addSpec()} loading={saving} disabled={!key.trim() || !value.trim()} /></Row>
        </Stack>
      </Section>
    </Screen>
  );
}
