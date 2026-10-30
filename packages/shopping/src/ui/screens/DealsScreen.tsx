import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";

import { ShopApiError } from "../../api/client";
import type { DealItem, Notification } from "../../api/types";
import { dealLine, formatPrice, verdictText } from "../../logic/format";
import { Banner, Body, Button, Card, Chip, Empty, H2, HeroPanel, PanelCaption, PanelChip, PanelValue, Row, Screen, Title } from "../kit";
import { openLink } from "../links";
import { useNav } from "../nav";
import { useShop } from "../runtime";
import { usePalette, type } from "../theme";

export function DealsScreen() {
  const { client } = useShop();
  const nav = useNav();
  const p = usePalette();
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [messages, setMessages] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Screen>
      <Title>Deals</Title>
      {error ? <Banner tone="bad">{error}</Banner> : null}
      <HeroPanel label="Cheap right now" chip={unread > 0 ? <PanelChip text={`${unread} new`} /> : null}>
        <PanelValue value={`${deals.length}`} suffix={deals.length === 1 ? "deal" : "deals"} />
        <PanelCaption>Products clearly below their usual price.</PanelCaption>
      </HeroPanel>
      <Row between>
        <H2>{unread > 0 ? `Messages (${unread} new)` : "Messages"}</H2>
        {unread > 0 ? <Button label="Mark read" kind="ghost" onPress={markRead} /> : null}
      </Row>
      {messages.length === 0 ? (
        <Empty title="No messages yet" message="Watch a search or a product and you are told here when its price drops." />
      ) : (
        messages.slice(0, 10).map((m) => (
          <Card key={m.id} onPress={() => (m.event.product_id ? nav.push({ name: "product", id: m.event.product_id }) : undefined)}>
            <Row between>
              <Text style={[type.body, { color: p.text, flex: 1, fontWeight: m.read ? "400" : "700" }]}>{m.message}</Text>
              {!m.read ? <Chip label="New" tone="good" /> : null}
            </Row>
            <Body small muted>{`${m.event.watch_name} · ${verdictText(m.event.verdict)}`}</Body>
            {m.event.url ? <Button label="Open in shop" kind="ghost" onPress={() => void openLink(m.event.url)} /> : null}
          </Card>
        ))
      )}
      <H2>Cheap right now</H2>
      {deals.length === 0 ? (
        <Body muted>No product is clearly below its usual price at the moment.</Body>
      ) : (
        deals.map((d) => (
          <Card key={d.product.id} onPress={() => nav.push({ name: "product", id: d.product.id })}>
            <Text style={[type.heading, { color: p.text }]}>{d.product.title}</Text>
            <Text style={[type.heading, { color: p.accent }]}>{formatPrice(d.deal.current_cents)}</Text>
            <Body small muted>{dealLine(d.deal)}</Body>
          </Card>
        ))
      )}
      <Button label="Refresh" kind="secondary" onPress={load} />
    </Screen>
  );
}
