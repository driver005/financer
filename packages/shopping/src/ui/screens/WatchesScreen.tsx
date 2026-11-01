import { useCallback, useEffect, useState } from "react";

import { Banner, Button, Card, EmptyState, Grid, Row, Screen, Section, Stack, Text, TextField, TopBar } from "@financer/ui";

import { ShopApiError } from "../../api/client";
import type { Watch } from "../../api/types";
import { formatCents } from "../../logic/format";
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
    <Screen header={<TopBar title="Watching" actions={watches.length > 0 ? <Button label="Add" variant="ghost" size="sm" icon="plus" onPress={() => nav.push({ name: "watch" })} /> : undefined} />}>
      {error ? <Banner tone="danger" action={<Button label="Try again" variant="soft" tone="danger" size="sm" onPress={() => { setError(null); void load(); }} />}>{error}</Banner> : null}
      {info && !info.continuous ? (
        <Banner tone="warning" title="This phone only looks when you search">
          A watch notices a price change the next time you search for it. For alerts while you are away, connect a server.
        </Banner>
      ) : null}
      {watches.length === 0 ? (
        <EmptyState icon="bell-plus-outline" title="Nothing watched" message="Say what you want a price alert for, and at what price." action={<Button label="Add a watch" onPress={() => nav.push({ name: "watch" })} />} />
      ) : (
        <Grid columns={{ base: 1, md: 2 }}>
          {watches.map((w) => (
            <Card key={w.id} gap="sm">
              <Text variant="subheading">{w.name}</Text>
              <Text variant="caption" tone="muted">
                {[w.query ? `“${w.query}”` : `${w.product_ids?.length ?? 0} products`, w.max_price_cents ? `at or below ${formatCents(w.max_price_cents)}` : null, w.min_discount_pct ? `or ${w.min_discount_pct} % off` : null]
                  .filter(Boolean)
                  .join(" · ")}
              </Text>
              <Row gap="sm">
                <Button
                  label={w.enabled === false ? "Switch on" : "Switch off"}
                  variant="soft"
                  tone="neutral"
                  size="sm"
                  onPress={async () => {
                    await client?.updateWatch({ ...w, id: w.id as number, enabled: w.enabled === false });
                    await load();
                  }}
                />
                <Button
                  label="Remove"
                  variant="ghost"
                  tone="danger"
                  size="sm"
                  onPress={async () => {
                    await client?.deleteWatch(w.id as number);
                    await load();
                  }}
                />
              </Row>
            </Card>
          ))}
        </Grid>
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
      nav.reset();
      nav.setTab("watches");
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "Could not save the watch.");
    }
  };

  return (
    <Screen header={<TopBar title="New watch" onBack={nav.pop} />} maxW="normal">
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <Section title="What to watch" description="A search: every product it finds is watched." card>
        <Stack gap="md">
          <TextField label="Name" value={name} onChangeText={setName} placeholder="Pixel under 500" capitalize />
          <TextField label="Search" value={query} onChangeText={setQuery} placeholder="pixel 9" />
        </Stack>
      </Section>
      <Section title="When to tell me" card>
        <Stack gap="md">
          <TextField label="At or below (€)" value={target} onChangeText={setTarget} keyboardType="numeric" placeholder="500" />
          <TextField label="Or this many % below its usual price" value={discount} onChangeText={setDiscount} keyboardType="numeric" />
        </Stack>
      </Section>
      <Row><Button label="Save watch" size="lg" icon="bell-plus-outline" onPress={() => void save()} disabled={!query.trim()} /></Row>
    </Screen>
  );
}
