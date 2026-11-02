import { useState } from "react";

import {
  Box, Card, Chip, ChipRow, ComparisonTable, DealBadge, FilterBar, OfferRow, PriceHistory, PriceTag, ProductCard, ProductGrid, Row, Section, Stack, Text,
  type AppliedFilter,
} from "@financer/ui";

import { compareColumns, compareRows, history, products } from "../sample";
import type { StoryDef } from "../Story";

function Cards() {
  const [sel, setSel] = useState<string[]>(["a"]);
  const toggle = (id: string) => setSel((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  return (
    <ProductGrid>
      {products.map((p) => (
        <ProductCard
          key={p.id}
          title={p.title}
          brand={p.brand}
          priceCents={p.price}
          wasCents={p.was}
          shop={p.shop}
          score={p.score}
          tier={p.tier}
          strengths={[...p.strengths]}
          weaknesses={[...p.weaknesses]}
          badges={p.was ? [{ label: "Good deal", tone: "success" }] : []}
          selected={sel.includes(p.id)}
          onToggleCompare={() => toggle(p.id)}
          onPress={() => {}}
        />
      ))}
    </ProductGrid>
  );
}

function Rows() {
  return (
    <Stack gap="md">
      {products.slice(0, 2).map((p) => (
        <ProductCard key={p.id} layout="row" title={p.title} brand={p.brand} priceCents={p.price} shop={p.shop} score={p.score} tier={p.tier} strengths={[...p.strengths]} weaknesses={[...p.weaknesses]} onPress={() => {}} />
      ))}
      <ProductCard layout="row" title={products[0].title} brand={products[0].brand} heading="Best overall · Best value" priceCents={products[0].price} shop={products[0].shop} score={products[0].score} scoreAs="badge" strengths={[...products[0].strengths]} strengthsAs="chips" onOpen={() => {}} onPress={() => {}} />
      <ProductCard layout="row" title="Flex 20 GB 5G" brand="Telco" priceCents={1999} perMonth shop="Tariff portal" score={71} scoreAs="badge" note="Save 12,00 € a month (288,00 € over 24 months)" onPress={() => {}} />
    </Stack>
  );
}

function Prices() {
  return (
    <Stack gap="lg">
      <PriceTag cents={64900} />
      <PriceTag cents={64900} wasCents={79900} />
      <PriceTag cents={1999} perMonth />
      <PriceTag cents={129900} size="lg" />
      <PriceTag cents={null} />
      <Row gap="sm" wrap>
        <DealBadge verdict="great" discountPct={25} />
        <DealBadge verdict="good" discountPct={14} />
        <DealBadge verdict="fair" discountPct={4} />
        <DealBadge verdict="none" />
      </Row>
      <Card padded>
        <OfferRow shop="Example Shop" priceCents={64900} wasCents={79900} detail="in stock · seen 2 hours ago" best onOpen={() => {}} />
        <OfferRow shop="Tech Store" priceCents={66900} detail="shipping 4,95 €" onOpen={() => {}} />
        <OfferRow shop="Fruit Store" priceCents={69900} detail="refurbished" inStock={false} />
      </Card>
    </Stack>
  );
}

function Filters() {
  const [applied, setApplied] = useState<AppliedFilter[]>([{ key: "price", label: "under 700 €" }, { key: "ram", label: "RAM ≥ 8 GB" }, { key: "brand", label: "Google" }]);
  const [sort, setSort] = useState("best");
  return (
    <FilterBar
      applied={applied}
      onRemove={(k) => setApplied(applied.filter((f) => f.key !== k))}
      onOpenFilters={() => {}}
      sort={{ value: sort, onChange: setSort, options: [{ value: "best", label: "Best match" }, { value: "price", label: "Price" }, { value: "rating", label: "Score" }, { value: "new", label: "Newest" }] }}
    />
  );
}

export const shopStories: StoryDef[] = [
  { id: "grid", title: "Product cards in a grid", note: "Two columns on a phone, three on a tablet, four and more on a large screen. Pick products to compare.", render: () => <Cards /> },
  {
    id: "section-tags",
    title: "Section with a tag and a note",
    note: "A small badge next to the title and a quiet count on the right.",
    render: () => (
      <Section title="Our picks" tag={{ label: "Top deals" }} aside="2 recommendations" description="The best choices for your weights">
        <ChipRow><Chip label="All deals" selected /><Chip label="15 % off or more" /><Chip label="smartphone" /></ChipRow>
      </Section>
    ),
  },
  { id: "rows", title: "Product cards as rows", note: "For lists and for subscriptions. The first is a pick: what it won, the match pill, strengths as chips and a View deal button.", render: () => <Rows /> },
  { id: "price", title: "Prices, deals and offers", render: () => <Prices /> },
  { id: "filters", title: "Filter and sort bar", note: "Applied filters are chips you can remove.", render: () => <Filters /> },
  { id: "compare", title: "Comparison table", note: "Sticky product headers; only what differs is shown by default; the best of a row is marked.", render: () => <Box h="preview"><ComparisonTable columns={compareColumns} rows={compareRows} /></Box> },
  { id: "history", title: "Price history", render: () => <PriceHistory cents={history} /> },
  { id: "empty-history", title: "Price history, too little data", render: () => <PriceHistory cents={[64900]} /> },
  { id: "text", title: "A product sheet in words", render: () => <Text variant="body" tone="muted">Prices and specs are read from your shops; scores explain themselves.</Text> },
];
