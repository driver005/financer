import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import {
  Banner, Box, Button, Card, Chip, ChipRow, EmptyState, FilterBar, IconButton, Meter, ProductCard, ProductGrid, Row, Screen, SearchBar, Section, Stack, Text,
  TopBar, type ProductCardProps,
} from "@financer/ui";

import { ShopApiError } from "../../api/client";
import type { Profile, SearchItem, SearchResponse } from "../../api/types";
import { indexRequestFor, nextStep, suggestionText } from "../../logic/searchPlan";
import { EXAMPLE_SEARCHES, SORT_OPTIONS, bestOffer, dealBadges, isMonthly, savingNote, sortItems, understood, type SortKey } from "../../logic/view";
import { useNav } from "../nav";
import { useShop } from "../runtime";

/** The search tab, and (with `category` fixed) the body of the subscriptions tab. */
export function SearchScreen({ category, title = "Shopping assistant", placeholder = "best phone under 600 € with a good camera", onBack, header }: {
  category?: string;
  title?: string;
  placeholder?: string;
  onBack?: () => void;
  /** Shown above the search box (the subscriptions tab puts the current plan there). */
  header?: ReactNode;
}) {
  const shop = useShop();
  const nav = useNav();
  const client = shop.client;
  const [query, setQuery] = useState("");
  const [profile, setProfile] = useState<Profile | undefined>();
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [sort, setSort] = useState<SortKey>("best");
  const lastQuery = useRef("");

  // the person's saved default profile (weights, wishes, budget)
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

  const search = useCallback(
    async (text: string) => {
      const q = text.trim();
      if (!q && !category) return;
      setQuery(q);
      lastQuery.current = q;
      setBusy(true);
      setSelected([]);
      const r = await run(q);
      setBusy(false);
      // Integrated: the search button is what reads the shops. A server already has it all.
      if (shop.integrated && shop.info && shop.info.sources.length > 0) await buildIndex(q, r);
    },
    [category, run, shop.integrated, shop.info, buildIndex],
  );

  const step = response ? nextStep(response, shop.integrated) : null;
  const toggle = (id: string) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : s.length < 6 ? [...s, id] : s));
  const noSources = shop.info !== null && shop.info.sources.length === 0;
  const months = response?.profile.horizon_months ?? 24;
  const items = response ? sortItems(response.items, sort) : [];
  const monthly = items.length > 0 && isMonthly(items[0]);

  const card = (item: SearchItem, layout: "grid" | "row"): ProductCardProps => {
    const offer = bestOffer(item);
    return {
      title: item.product.title,
      brand: item.product.brand,
      imageUri: item.product.image,
      priceCents: item.ranked.price_cents,
      perMonth: isMonthly(item),
      wasCents: offer && !offer.recurring ? offer.list_price_cents : null,
      shop: item.ranked.shop,
      score: item.ranked.score,
      tier: item.ranked.tier,
      badges: dealBadges(item.deal?.verdict),
      strengths: item.ranked.strengths,
      weaknesses: item.ranked.weaknesses,
      note: savingNote(item, months),
      layout,
      selected: selected.includes(item.product.id),
      onToggleCompare: () => toggle(item.product.id),
      onPress: () => nav.push({ name: "product", id: item.product.id }),
    };
  };

  return (
    <Screen
      header={
        <TopBar
          title={title}
          onBack={onBack}
          actions={response?.category ? <IconButton icon="tune-variant" label="What matters to me" onPress={() => nav.push({ name: "weights", category: response.category as string })} /> : undefined}
        />
      }
      footer={
        selected.length >= 2 ? (
          <Box bg="surface" px="lg" py="md" shadow="lg">
            <Button label={`Compare ${selected.length} products`} size="lg" full icon="scale-balance" onPress={() => nav.push({ name: "compare", ids: selected, category: response?.category ?? null })} />
          </Box>
        ) : undefined
      }
    >
      {header}
      <Stack gap="md">
        <SearchBar value={query} onChangeText={setQuery} onSubmit={() => void search(query)} placeholder={placeholder} testID="search-box" />
        <Row gap="md" wrap>
          <Button label={shop.integrated ? "Search the web" : "Search"} icon="magnify" size="lg" onPress={() => void search(query)} loading={busy || shop.indexing !== null} disabled={!client} />
          <Box grow>
            <Text variant="caption" tone="muted">
              {shop.integrated ? "Nothing is read from the web until you press the button." : `${shop.info?.products ?? 0} products on file, kept fresh by the server.`}
            </Text>
          </Box>
        </Row>
      </Stack>

      {shop.indexing ? (
        <Card tone="accent">
          <Row justify="between" gap="md">
            <Box grow><Text variant="bodyStrong" tone="on-accent-soft">{shop.indexing.model.title}</Text></Box>
            <Button label="Stop" variant="ghost" size="sm" onPress={() => void shop.cancelIndex()} />
          </Row>
          <Meter value={shop.indexing.model.indeterminate ? 0.08 : shop.indexing.model.percent / 100} label="Indexing progress" />
          <Text variant="caption" tone="on-accent-soft">{shop.indexing.model.body} · {shop.indexing.model.percent} %</Text>
        </Card>
      ) : null}
      {noSources ? (
        <Banner tone="warning" title="No shops are set up" action={<Button label="Add shops" variant="soft" tone="warning" size="sm" onPress={() => nav.push({ name: "sources" })} />}>
          There is nothing to read prices from yet.
        </Banner>
      ) : null}
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {response ? (
        <Stack gap="xl">
          {response.category ? (
            <ChipRow>
              <Chip label={response.category.replace(/_/g, " ")} icon="shape-outline" tone={response.category_guessed ? "warning" : "accent"} selected />
              {understood(response.parsed).map((f) => <Chip key={f.key} label={f.label} />)}
              {response.excluded.length > 0 ? <Chip label={`${response.excluded.length} left out`} icon="filter-off-outline" /> : null}
            </ChipRow>
          ) : null}

          {step?.kind === "suggest-index" && !shop.indexing && shop.info && shop.info.sources.length > 0 ? (
            <Banner title={shop.integrated ? "Build the index" : "Refresh now"} action={<Button label={shop.integrated ? "Build the index" : "Refresh now"} onPress={() => void buildIndex(lastQuery.current, response)} loading={shop.indexing !== null} />}>
              {suggestionText(step.reason)}
            </Banner>
          ) : null}
          {step?.kind === "none-found" ? <EmptyState icon="magnify-close" title="Nothing matches" message="Try fewer words or a higher price limit." /> : null}

          <Picks response={response} />

          {items.length > 0 ? (
            <Section title={`${items.length} ranked`}>
              <FilterBar applied={[]} onRemove={() => {}} sort={{ value: sort, onChange: setSort, options: SORT_OPTIONS }} />
              {monthly ? (
                <Stack gap="md">{items.map((it) => <ProductCard key={it.product.id} {...card(it, "row")} />)}</Stack>
              ) : (
                <ProductGrid>{items.map((it) => <ProductCard key={it.product.id} {...card(it, "grid")} />)}</ProductGrid>
              )}
              <Row wrap gap="sm">
                <Button label="Tell me about deals" icon="bell-plus-outline" variant="soft" onPress={() => nav.push({ name: "watch", query: lastQuery.current, category: response.category })} />
              </Row>
            </Section>
          ) : null}

          {response.excluded.length > 0 ? (
            <Section title="Left out">
              <Stack gap="xs">
                {response.excluded.slice(0, 5).map((e) => (
                  <Text key={e.product_id} variant="caption" tone="muted">{e.product_id.split(":")[1] ?? e.product_id}: {e.reasons.join(", ")}</Text>
                ))}
              </Stack>
            </Section>
          ) : null}
        </Stack>
      ) : (
        <Stack gap="lg">
          <EmptyState icon="shopping-search-outline" title={shop.integrated ? "Search, compare, decide" : "Ask the server"} message="Describe what you want. Prices, specs, deals and your own weights decide the order." />
          <Section title="Try">
            <ChipRow>
              {EXAMPLE_SEARCHES.map((q) => <Chip key={q} label={q} icon="magnify" onPress={() => void search(q)} />)}
            </ChipRow>
          </Section>
        </Stack>
      )}
      <Text variant="caption" tone="subtle" align="center">
        {shop.where === "phone" ? "Running on this phone" : shop.where === "server" ? "Connected to your server" : ""}
      </Text>
    </Screen>
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
    <Section title="Our picks" description="The best choices for your weights">
      <Stack gap="sm">
        {[...cards.entries()].map(([id, labels]) => {
          const item = by.get(id) as SearchItem;
          return (
            <ProductCard
              key={id}
              layout="row"
              title={item.product.title}
              brand={labels.join(" · ")}
              imageUri={item.product.image}
              priceCents={item.ranked.price_cents}
              perMonth={isMonthly(item)}
              shop={item.ranked.shop}
              score={item.ranked.score}
              onPress={() => nav.push({ name: "product", id })}
            />
          );
        })}
      </Stack>
    </Section>
  );
}
