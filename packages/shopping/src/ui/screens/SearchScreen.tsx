import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Text, View } from "react-native";

import type { Profile, SearchItem, SearchResponse } from "../../api/types";
import { ShopApiError } from "../../api/client";
import { dealLine, formatPrice, savingText, verdictText } from "../../logic/format";
import { chipsFor, indexRequestFor, nextStep, suggestionText } from "../../logic/searchPlan";
import { openLink } from "../links";
import { useNav } from "../nav";
import { Banner, Body, Button, Card, Chip, Empty, Field, H2, Meter, Problems, Row, Screen, Title } from "../kit";
import { useShop } from "../runtime";
import { space, usePalette, type } from "../theme";

/** The search tab, and (with `category` fixed) the body of the subscriptions tab. */
export function SearchScreen({ category, title = "Shopping assistant", placeholder = "best phone under 600 € with a good camera", onBack, header }: {
  category?: string;
  title?: string;
  placeholder?: string;
  onBack?: () => void;
  /** Shown between the title and the search box (the subscriptions tab puts the current plan here). */
  header?: ReactNode;
}) {
  const shop = useShop();
  const nav = useNav();
  const p = usePalette();
  const client = shop.client;
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState<Profile | undefined>();
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const lastQuery = useRef("");

  // the person's saved default profile (weights, preferences, budget)
  useEffect(() => {
    let alive = true;
    client?.profiles().then((all) => alive && setProfile(all.find((x) => x.name === "default")?.profile)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [client, shop.profileVersion]);

  const run = useCallback(
    async (text: string): Promise<SearchResponse | null> => {
      if (!client) return null;
      setError(null);
      try {
        const r = await client.search({ query: text, category, profile });
        setResponse(r);
        return r;
      } catch (e) {
        setError(e instanceof ShopApiError ? e.message : "Could not search.");
        return null;
      }
    },
    [client, category, profile],
  );

  // a changed profile re-ranks the last search at once
  useEffect(() => {
    if (lastQuery.current !== "" || category) void run(lastQuery.current);
  }, [profile, run, category]);

  const buildIndex = useCallback(
    async (text: string, r?: SearchResponse | null) => {
      try {
        const job = await shop.startIndex(indexRequestFor({ query: text || (category ?? ""), category }, r ?? undefined));
        if (job) await run(text);
      } catch (e) {
        setError(e instanceof ShopApiError ? e.message : "Could not start the search.");
      }
    },
    [shop, category, run],
  );

  const onSearch = useCallback(async () => {
    const text = query.trim();
    if (!text && !category) return;
    lastQuery.current = text;
    setBusy(true);
    setSelected([]);
    const r = await run(text);
    setBusy(false);
    // Integrated: the search button is what reads the shops. A server already has it all.
    if (shop.integrated && shop.info && shop.info.sources.length > 0) await buildIndex(text, r);
  }, [query, category, run, shop.integrated, shop.info, buildIndex]);

  const step = response ? nextStep(response, shop.integrated) : null;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 6 ? [...s, id] : s));
  const noSources = shop.info !== null && shop.info.sources.length === 0;

  return (
    <Screen>
      <Title onBack={onBack}>{title}</Title>
      {header}
      <Field label="What are you looking for?" value={query} onChangeText={setQuery} placeholder={placeholder} returnKeyType="search" onSubmitEditing={onSearch} />
      <Row>
        <View style={{ flex: 1 }}>
          <Button label={shop.integrated ? "Search the web" : "Search"} onPress={onSearch} busy={busy || shop.indexing !== null} disabled={!client} />
        </View>
        {response?.category ? <Button label="Weights" kind="secondary" onPress={() => nav.push({ name: "weights", category: response.category as string })} /> : null}
      </Row>
      {shop.integrated ? (
        <Body small muted>
          Nothing is read from the web until you press the button.
        </Body>
      ) : (
        <Body small muted>
          {shop.info?.products ?? 0} products on file, kept fresh by the server.
        </Body>
      )}

      {shop.indexing ? <IndexProgress /> : null}
      {noSources ? (
        <Banner tone="warn" action={<Button label="Add shops" kind="secondary" onPress={() => nav.push({ name: "sources" })} />}>
          No shops are set up, so there is nothing to read prices from.
        </Banner>
      ) : null}
      {error ? <Banner tone="bad">{error}</Banner> : null}

      {response ? (
        <>
          {response.category ? (
            <Row wrap>
              <Chip label={response.category.replace(/_/g, " ")} tone={response.category_guessed ? "warn" : undefined} />
              {chipsFor(response).map((c) => (
                <Chip key={c} label={c} />
              ))}
              {response.excluded.length > 0 ? <Chip label={`${response.excluded.length} left out`} /> : null}
            </Row>
          ) : null}

          {step?.kind === "suggest-index" && !shop.indexing && shop.info && shop.info.sources.length > 0 ? (
            <Banner
              action={
                <Button
                  label={shop.integrated ? "Build the index" : "Refresh now"}
                  onPress={() => buildIndex(lastQuery.current, response)}
                  busy={shop.indexing !== null}
                />
              }
            >
              {suggestionText(step.reason)}
            </Banner>
          ) : null}
          {step?.kind === "none-found" ? <Empty title="Nothing matches" message="Try fewer words or a higher price limit." /> : null}

          <Picks response={response} />
          {response.items.length > 0 ? <H2>{`${response.items.length} ranked`}</H2> : null}
          {response.items.map((item, i) => (
            <ResultCard
              key={item.product.id}
              item={item}
              rank={i + 1}
              monthly={Boolean(item.product.offers[0]?.recurring)}
              horizon={response.profile.horizon_months ?? 24}
              selected={selected.includes(item.product.id)}
              onSelect={() => toggle(item.product.id)}
              onOpen={() => nav.push({ name: "product", id: item.product.id })}
            />
          ))}
          {response.items.length > 0 ? (
            <Row wrap>
              <Button
                label={selected.length >= 2 ? `Compare ${selected.length}` : "Pick 2 or more to compare"}
                disabled={selected.length < 2}
                onPress={() => nav.push({ name: "compare", ids: selected, category: response.category })}
              />
              <Button label="Tell me about deals" kind="secondary" onPress={() => nav.push({ name: "watch", query: lastQuery.current, category: response.category })} />
            </Row>
          ) : null}
          <Problems items={response.excluded.slice(0, 5).map((e) => `${e.product_id.split(":")[1] ?? e.product_id}: ${e.reasons.join(", ")}`)} />
        </>
      ) : (
        <Empty
          title={shop.integrated ? "Search, compare, decide" : "Ask the server"}
          message="Describe what you want. Prices, specs, deals and your own weights decide the order."
        />
      )}
      {response === null ? null : <View style={{ height: space.lg }} />}
      <Text style={[type.small, { color: p.muted }]}>{shop.where === "phone" ? "Running on this phone" : shop.where === "server" ? "Connected to your server" : ""}</Text>
    </Screen>
  );
}

function IndexProgress() {
  const shop = useShop();
  const m = shop.indexing?.model;
  if (!m) return null;
  return (
    <Card tone="accent">
      <Row between>
        <Body>{m.title}</Body>
        <Button label="Stop" kind="ghost" onPress={() => void shop.cancelIndex()} />
      </Row>
      <Meter value={m.indeterminate ? 0.08 : m.percent / 100} label="Indexing progress" />
      <Body small muted>
        {m.body} · {m.percent} %
      </Body>
    </Card>
  );
}

function Picks({ response }: { response: SearchResponse }) {
  const nav = useNav();
  const by = new Map(response.items.map((i) => [i.product.id, i]));
  const entries: [string, string | null][] = [
    ["Best overall", response.picks.best_overall],
    ["Best value", response.picks.best_value],
    ["Cheapest good one", response.picks.cheapest_good],
    ["Premium pick", response.picks.premium],
  ];
  // one card per product, with every title it won
  const cards = new Map<string, string[]>();
  for (const [label, id] of entries) if (id && by.has(id)) cards.set(id, [...(cards.get(id) ?? []), label]);
  if (cards.size === 0) return null;
  return (
    <View style={{ gap: space.sm }}>
      <H2>Our picks</H2>
      {[...cards.entries()].map(([id, labels]) => {
        const item = by.get(id) as SearchItem;
        return (
          <Card key={id} tone="accent" onPress={() => nav.push({ name: "product", id })}>
            <Body small muted>
              {labels.join(" · ")}
            </Body>
            <Body>{item.product.title}</Body>
            <Body small muted>
              {formatPrice(item.ranked.price_cents, Boolean(item.product.offers[0]?.recurring))} · score {Math.round(item.ranked.score)}
            </Body>
          </Card>
        );
      })}
    </View>
  );
}

export function ResultCard({ item, rank, monthly, horizon, selected, onSelect, onOpen }: {
  item: SearchItem;
  rank: number;
  monthly: boolean;
  horizon: number;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
}) {
  const p = usePalette();
  const r = item.ranked;
  const offer = item.product.offers.find((o) => o.url === r.url) ?? item.product.offers[0];
  return (
    <Card onPress={onOpen}>
      <Row between>
        <Text style={[type.small, { color: p.muted }]}>#{rank}</Text>
        <Chip label={selected ? "Selected" : "Compare"} selected={selected} onPress={onSelect} />
      </Row>
      <Text style={[type.heading, { color: p.text }]}>{item.product.title}</Text>
      <Row between>
        <Text style={[type.heading, { color: p.accent }]}>{formatPrice(r.price_cents, monthly)}</Text>
        <Text style={[type.body, { color: p.muted }]}>{r.shop ?? ""}</Text>
      </Row>
      <Row>
        <View style={{ flex: 1 }}>
          <Meter value={r.score / 100} label={`Score ${Math.round(r.score)} of 100`} />
        </View>
        <Text style={[type.body, { color: p.text, fontWeight: "700" }]}>{Math.round(r.score)}</Text>
      </Row>
      <Row wrap>
        {r.tier ? <Chip label={r.tier} /> : null}
        {item.deal && item.deal.verdict !== "none" && item.deal.verdict !== "fair" ? <Chip label={verdictText(item.deal.verdict)} tone="good" /> : null}
        {r.on_frontier ? <Chip label="Efficient price" /> : null}
        {r.confidence < 0.7 ? <Chip label="Some specs unknown" tone="warn" /> : null}
      </Row>
      {r.strengths.length > 0 ? (
        <Text style={[type.small, { color: p.good }]}>Strong: {r.strengths.join(", ")}</Text>
      ) : null}
      {r.weaknesses.length > 0 ? <Text style={[type.small, { color: p.bad }]}>Weak: {r.weaknesses.join(", ")}</Text> : null}
      {item.deal && item.deal.verdict !== "none" ? <Text style={[type.small, { color: p.muted }]}>{dealLine(item.deal)}</Text> : null}
      {item.saving ? <Text style={[type.small, { color: item.saving.per_month_cents > 0 ? p.good : p.muted }]}>{savingText(item.saving.per_month_cents, item.saving.over_horizon_cents, horizon, item.saving.current)}</Text> : null}
      {offer?.url ? (
        <Button label="Open in shop" kind="ghost" onPress={() => void openLink(offer.url)} />
      ) : null}
    </Card>
  );
}
