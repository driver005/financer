import { useCallback, useEffect, useState } from "react";

import { ShopApiError } from "../../api/client";
import type { Watch } from "../../api/types";
import { formatCents } from "../../logic/format";
import { Banner, Body, Button, Card, Empty, Field, H2, HeroPanel, PanelCaption, PanelChip, PanelValue, Row, Screen, Title } from "../kit";
import { useNav } from "../nav";
import { useShop } from "../runtime";

export function WatchesScreen() {
  const { client, info } = useShop();
  const nav = useNav();
  const [watches, setWatches] = useState<Watch[]>([]);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    try {
      setWatches(await client.watches());
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "Could not load the watches.");
    }
  }, [client]);
  useEffect(() => void load(), [load]);

  return (
    <Screen>
      <Title>Watching</Title>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      {info && !info.continuous ? (
        <Banner tone="warn">
          This phone only looks when you search. A watch notices a price change the next time you search for it. For alerts while you are away, connect a server.
        </Banner>
      ) : null}
      {watches.length > 0 ? (
        <HeroPanel label="Price alerts" chip={<PanelChip text={`${watches.filter((w) => w.enabled !== false).length} on`} />}>
          <PanelValue value={`${watches.length}`} suffix={watches.length === 1 ? "watch" : "watches"} />
          <PanelCaption>You are told when a price drops to your target.</PanelCaption>
        </HeroPanel>
      ) : null}
      {watches.length === 0 ? (
        <Empty title="Nothing watched" message="Say what you want a price alert for, and at what price." action={<Button label="Add a watch" onPress={() => nav.push({ name: "watch" })} />} />
      ) : (
        <>
          {watches.map((w) => (
            <Card key={w.id}>
              <H2>{w.name}</H2>
              <Body small muted>
                {[w.query ? `“${w.query}”` : `${w.product_ids?.length ?? 0} products`, w.max_price_cents ? `at or below ${formatCents(w.max_price_cents)}` : null, w.min_discount_pct ? `or ${w.min_discount_pct} % off` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Body>
              <Row>
                <Button
                  label={w.enabled === false ? "Switch on" : "Switch off"}
                  kind="secondary"
                  onPress={async () => {
                    await client?.updateWatch({ ...w, id: w.id as number, enabled: w.enabled === false });
                    await load();
                  }}
                />
                <Button
                  label="Remove"
                  kind="ghost"
                  onPress={async () => {
                    await client?.deleteWatch(w.id as number);
                    await load();
                  }}
                />
              </Row>
            </Card>
          ))}
          <Button label="Add a watch" onPress={() => nav.push({ name: "watch" })} />
        </>
      )}
    </Screen>
  );
}

export function NewWatchScreen({ query: initial = "", category }: { query?: string; category?: string | null }) {
  const { client } = useShop();
  const nav = useNav();
  const [name, setName] = useState(initial);
  const [query, setQuery] = useState(initial);
  const [target, setTarget] = useState("");
  const [discount, setDiscount] = useState("15");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    const euros = Number(target.replace(",", "."));
    const pct = Number(discount.replace(",", "."));
    try {
      await client?.createWatch({
        name: name.trim() || query.trim(),
        query: query.trim() || null,
        category: category ?? null,
        max_price_cents: target.trim() && euros > 0 ? Math.round(euros * 100) : null,
        min_discount_pct: discount.trim() && pct > 0 ? pct : null,
        enabled: true,
      });
      nav.pop();
      nav.setTab("watches");
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "Could not save the watch.");
    }
  };

  return (
    <Screen>
      <Title onBack={nav.pop}>New watch</Title>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      <Field label="Name" value={name} onChangeText={setName} placeholder="Pixel under 500" />
      <Field label="What to watch (a search)" value={query} onChangeText={setQuery} placeholder="pixel 9" />
      <Field label="Tell me at or below (€)" value={target} onChangeText={setTarget} keyboardType="numeric" placeholder="500" />
      <Field label="Or when it is this many % below its usual price" value={discount} onChangeText={setDiscount} keyboardType="numeric" />
      <Button label="Save" onPress={save} disabled={!query.trim()} />
    </Screen>
  );
}
