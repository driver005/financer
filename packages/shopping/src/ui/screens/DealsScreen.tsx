import { useCallback, useEffect, useState } from "react";

import { Badge, Banner, Box, Button, Card, Chip, ChipRow, Divider, EmptyState, Grid, ListItem, ProductCard, Screen, Section, TopBar } from "@financer/ui";

import { ShopApiError } from "../../api/client";
import type { DealItem, Notification } from "../../api/types";
import { dealLine } from "../../logic/format";
import { dealFilters, filterDeals, type DealFilter } from "../../logic/view";
import { openLink } from "../links";
import { useNav } from "../nav";
import { useShop } from "../runtime";

export function DealsScreen() {
  const { client } = useShop();
  const nav = useNav();
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [messages, setMessages] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<DealFilter>("all");

  const load = useCallback(async () => {
    if (!client) return;
    try {
      const [d, n] = await Promise.all([client.deals(), client.notifications(0, 30)]);
      setDeals(d);
      setMessages([...n.items].reverse());
      setUnread(n.unread);
    } catch (e) {
      setError(e instanceof ShopApiError ? e.message : "Could not load deals.");
    }
  }, [client]);
  useEffect(() => void load(), [load]);

  const markRead = async () => {
    const last = messages[0]?.id;
    if (client && last) {
      await client.markRead(last);
      await load();
    }
  };

  const filters = dealFilters(deals);
  const shown = filterDeals(deals, filters.some((f) => f.key === filter) ? filter : "all");

  return (
    <Screen header={<TopBar title="Deals" actions={<Button label="Refresh" variant="ghost" size="sm" icon="refresh" onPress={() => void load()} />} />}>
      {error ? <Banner tone="danger" action={<Button label="Try again" variant="soft" tone="danger" size="sm" onPress={() => { setError(null); void load(); }} />}>{error}</Banner> : null}
      <Section title="Messages" aside={`${unread} new`} action={unread > 0 ? { label: "Mark read", onPress: () => void markRead() } : undefined}>
        {messages.length === 0 ? (
          <EmptyState card icon="bell-outline" title="No messages yet" message="Watch a search or a product and you are told here when its price drops." action={<Button label="Start watching" variant="soft" icon="bell-plus-outline" onPress={() => nav.push({ name: "watch" })} />} />
        ) : (
          <Card padded={false}>
            <Box px="lg">
              {messages.slice(0, 10).map((m, i) => (
                <Box key={m.id}>
                  {i > 0 ? <Divider /> : null}
                  <ListItem
                    title={m.message}
                    subtitle={m.event.watch_name}
                    icon={m.read ? "bell-outline" : "bell-ring"}
                    trailing={m.read ? undefined : <Badge label="New" tone="success" solid />}
                    onPress={() => (m.event.product_id ? nav.push({ name: "product", id: m.event.product_id }) : m.event.url ? void openLink(m.event.url) : undefined)}
                  />
                </Box>
              ))}
            </Box>
          </Card>
        )}
      </Section>
      <Section title="Cheap right now" tag={deals.length > 0 ? { label: `${deals.length} live ${deals.length === 1 ? "deal" : "deals"}` } : undefined} description="Clearly below the price we usually saw">
        {deals.length > 0 && filters.length > 1 ? (
          <ChipRow>
            {filters.map((f) => <Chip key={f.key} label={f.label} selected={filter === f.key} onPress={() => setFilter(f.key)} />)}
          </ChipRow>
        ) : null}
        {deals.length === 0 ? (
          <EmptyState icon="tag-off-outline" title="No clear deals" message="No product is clearly below its usual price at the moment." />
        ) : (
          <Grid columns={{ base: 1, md: 2 }}>
            {shown.map((d) => (
              <ProductCard
                key={d.product.id}
                layout="row"
                title={d.product.title}
                brand={d.product.brand}
                imageUri={d.product.image}
                priceCents={d.deal.current_cents}
                wasCents={d.deal.reference_cents}
                shop={dealLine(d.deal)}
                badges={d.deal.verdict === "great" ? [{ label: "Great deal", tone: "success" }] : [{ label: "Good deal", tone: "success" }]}
                onPress={() => nav.push({ name: "product", id: d.product.id })}
                onOpen={d.product.offers[0]?.url ? () => void openLink(d.product.offers[0].url) : undefined}
              />
            ))}
          </Grid>
        )}
      </Section>
    </Screen>
  );
}
