import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";

import { ShopApiError } from "../../api/client";
import type { AttrValue, ProductDetail } from "../../api/types";
import { ago, dealLine, formatPrice, planTerms, verdictText } from "../../logic/format";
import { Banner, Body, Button, Card, Chip, Empty, Field, H2, Row, Screen, Title } from "../kit";
import { openLink } from "../links";
import { useNav } from "../nav";
import { useShop } from "../runtime";
import { space, usePalette, type } from "../theme";

function show(v: AttrValue, unit?: string | null): string {
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.join(", ");
  return typeof v === "number" && unit ? `${v} ${unit}` : String(v);
}

export function ProductScreen({ id }: { id: string }) {
  const { client } = useShop();
  const nav = useNav();
  const p = usePalette();
  const [detail, setDetail] = useState<ProductDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const now = Math.floor(Date.now() / 1000);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setDetail(await client.product(id));
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "Could not load the product.");
    }
  }, [client, id]);
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
      <Screen>
        <Title onBack={nav.pop}>Product</Title>
        {error ? <Banner tone="bad">{error}</Banner> : <Body muted>Loading…</Body>}
      </Screen>
    );
  }
  const { product, deal, history, schema } = detail;
  const offers = [...product.offers].sort((a, b) => a.price_cents + (a.recurring?.monthly_cents ?? 0) - (b.price_cents + (b.recurring?.monthly_cents ?? 0)));
  const monthly = offers.some((o) => o.recurring);
  const defs = new Map((schema.attributes ?? []).map((a) => [a.key, a]));
  const specKeys = Object.keys(product.attributes).sort((a, b) => (defs.has(b) ? 1 : 0) - (defs.has(a) ? 1 : 0) || a.localeCompare(b));
  const prices = history.map((h) => h.cents);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);

  return (
    <Screen>
      <Title onBack={nav.pop}>{product.title}</Title>
      {product.brand ? <Body muted>{product.brand}</Body> : null}
      {error ? <Banner tone="bad">{error}</Banner> : null}

      {deal && deal.verdict !== "none" ? (
        <Banner>
          <View style={{ gap: 4 }}>
            <Text style={[type.heading, { color: p.text }]}>{verdictText(deal.verdict)}</Text>
            <Body small muted>
              {dealLine(deal)}
            </Body>
          </View>
        </Banner>
      ) : deal ? (
        <Body small muted>
          {dealLine(deal)}
        </Body>
      ) : null}

      <H2>{monthly ? "Plans and prices" : "Where to buy"}</H2>
      {offers.length === 0 ? <Empty title="No price yet" message="Build the index for a search that finds this product." /> : null}
      {offers.map((o) => (
        <Card key={`${o.shop}${o.url}${o.condition}`} onPress={() => void openLink(o.url)}>
          <Row between>
            <Body>{o.shop}</Body>
            <Text style={[type.heading, { color: p.accent }]}>
              {o.recurring ? formatPrice(o.recurring.monthly_cents, true) : formatPrice(o.price_cents)}
            </Text>
          </Row>
          {o.recurring ? <Body small muted>{planTerms(o)}</Body> : null}
          {o.list_price_cents && !o.recurring ? <Body small muted>{`List price ${formatPrice(o.list_price_cents)}`}</Body> : null}
          <Body small muted>
            {[o.in_stock === false ? "out of stock" : "in stock", o.condition && o.condition !== "new" ? o.condition : null, o.seen_at ? `seen ${ago(o.seen_at, now)}` : null].filter(Boolean).join(" · ")}
          </Body>
        </Card>
      ))}

      {history.length >= 2 ? (
        <>
          <H2>Price history</H2>
          <Card>
            <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 2, height: 56 }}>
              {history.slice(-40).map((h) => (
                <View key={h.at} style={{ flex: 1, height: 8 + (hi === lo ? 24 : ((h.cents - lo) / (hi - lo)) * 40), backgroundColor: p.accent, borderRadius: 2 }} />
              ))}
            </View>
            <Row between>
              <Body small muted>{`low ${formatPrice(lo, monthly)}`}</Body>
              <Body small muted>{`high ${formatPrice(hi, monthly)}`}</Body>
            </Row>
          </Card>
        </>
      ) : null}

      <H2>Specifications</H2>
      <Card>
        {specKeys.length === 0 ? <Body muted>No specs known yet. Add the ones you know below.</Body> : null}
        {specKeys.map((k) => {
          const def = defs.get(k);
          return (
            <Row key={k} between>
              <Text style={[type.body, { color: p.muted, flex: 1 }]}>{def?.label ?? k.replace(/_/g, " ")}</Text>
              <Text style={[type.body, { color: p.text, flex: 1, textAlign: "right" }]}>{show(product.attributes[k], def?.unit)}</Text>
            </Row>
          );
        })}
      </Card>

      <H2>Add or correct a spec</H2>
      <Body small muted>
        Your own facts count in the ranking and survive later crawls. Any name works; names the category knows are used by its criteria.
      </Body>
      <Row wrap>
        {(schema.attributes ?? []).filter((a) => !(a.key in product.attributes)).slice(0, 8).map((a) => (
          <Chip key={a.key} label={a.label} selected={key === a.key} onPress={() => setKey(a.key)} />
        ))}
      </Row>
      <Field label="Name" value={key} onChangeText={setKey} placeholder="camera_score" />
      <Field label="Value" value={value} onChangeText={setValue} placeholder="92 or 5000 mAh or yes" />
      <Button label="Save spec" onPress={addSpec} busy={saving} disabled={!key.trim() || !value.trim()} />

      <Row wrap>
        <Button label="Tell me about deals" kind="secondary" onPress={() => nav.push({ name: "watch", query: product.title, category: product.category })} />
      </Row>
      <View style={{ height: space.xl }} />
    </Screen>
  );
}
