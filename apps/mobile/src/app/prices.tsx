import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Badge, Box, Button, Card, HeroCard, IconBadge, Note, Row, SearchBar, Snackbar, Text, VirtualList } from "@financer/ui";

import type { Price } from "@/api/client";
import { useApi } from "@/api/config";
import { ChainPriceRow } from "@/components/grocery/ChainPriceRow";
import { Page } from "@/components/Page";
import { SectionSwitch } from "@/components/SectionSwitch";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { formatCents, formatDate } from "@/format";
import { chainTone, extraText, initials, itemSaving, rankPrices, summarizePrices, type PriceGroup } from "@/groceryView";
import { chainLabel, useScreenData } from "@/hooks";

export default function Prices() {
  const { api, loaded, mode } = useApi();
  const { data, error, busy, reload } = useScreenData((a) => a.prices());
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const all = useMemo<PriceGroup[]>(() => {
    const byItem = new Map<string, PriceGroup>();
    for (const p of data ?? []) {
      const g = byItem.get(p.item) ?? { item: p.item, name: p.item_name, pack: p.reference_pack, prices: [] };
      g.prices.push(p);
      byItem.set(p.item, g);
    }
    return [...byItem.values()].map((g) => ({ ...g, prices: [...g.prices].sort((a, b) => a.price_cents - b.price_cents) })).sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [data]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all.filter((g) => !q || g.name.toLowerCase().includes(q));
  }, [all, query]);

  const summary = useMemo(() => summarizePrices(all), [all]);

  const refresh = useCallback(async () => {
    if (!api) return;
    setRefreshing(true);
    try {
      const r = await api.refreshPrices();
      const failed = r.sources.filter((s) => !s.ok);
      setNotice(failed.length ? `${r.stored} prices. ${failed.length} source(s) failed: ${failed.map((f) => f.name).join(", ")}` : `${r.stored} prices updated`);
      await reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [api, reload]);

  if (!loaded) return <Page title="Prices"><Loading /></Page>;
  if (!api) return <Page title="Prices"><SectionSwitch /><NeedsSetup /></Page>;

  const loading = !data && !error;
  const empty = !!data && data.length === 0;

  return (
    <Page title="Prices" fixed>
      <VirtualList
        data={empty || loading ? [] : groups}
        keyExtractor={(g) => g.item}
        refreshing={busy}
        onRefresh={reload}
        gap="md"
        header={
          <Box gap="md">
            <SectionSwitch />
            {!empty && !loading ? <Hero summary={summary} /> : null}
            {!empty ? (
              <>
                <Row gap="sm">
                  <Box equal><Button label={refreshing ? "Refreshing…" : "Refresh"} icon="refresh" onPress={refresh} disabled={refreshing} /></Box>
                  <Box equal><Button label="Scan" icon="barcode-scan" variant="outline" onPress={() => router.push("/scan")} /></Box>
                </Row>
                <SearchBar placeholder="Search items" value={query} onChangeText={setQuery} />
              </>
            ) : null}
            {error ? <Note tone="error">{error}</Note> : null}
            {loading ? <Loading rows={3} /> : null}
          </Box>
        }
        empty={
          loading ? undefined : empty ? (
            <Empty
              mood="worried"
              title="No prices yet"
              message={mode === "embedded" ? "Choose your price sources in Settings > On-phone settings (see docs/PRICES.md), then fetch the first prices." : "Set up price sources on the server (see docs/PRICES.md), then fetch the first prices."}
              actionLabel={refreshing ? "Refreshing…" : "Refresh prices"}
              actionIcon="refresh"
              onAction={refresh}
            />
          ) : (
            <Text variant="body" tone="muted" align="center">{`Nothing matches “${query.trim()}”.`}</Text>
          )
        }
        footer={<Snackbar visible={!!notice} onDismiss={() => setNotice(null)} seconds={5} tone="info">{notice ?? ""}</Snackbar>}
        renderItem={(g) => <ItemCard group={g} />}
      />
    </Page>
  );
}

/** The top card: which chain wins most items and what choosing well saves. */
function Hero({ summary }: { summary: ReturnType<typeof summarizePrices> }) {
  if (summary.compared === 0) return null;
  const leader = summary.leader;
  const topCount = summary.wins[0]?.count ?? 0;
  const names = summary.top.map(chainLabel);
  const headline = names.join(" & ");
  const sub = leader ? `cheapest for ${leader.count} of ${summary.compared} compared items` : `level: each cheapest for ${topCount} of ${summary.compared} compared items`;
  return (
    <HeroCard label="Best chain right now">
      <Box gap="md" accessible accessibilityLabel={`${leader ? `${headline} is cheapest, ${sub}` : `${headline}, ${sub}`}. Choosing the cheapest chain per item saves up to ${formatCents(summary.savingCents)}.`}>
        <Row gap="md">
          <Row gap="xs">
            {summary.top.slice(0, 3).map((chain) => (
              <IconBadge key={chain} tone={chainTone(chain)} text={initials(chainLabel(chain))} />
            ))}
          </Row>
          <Box grow>
            <Text variant="title" tone="on-accent-solid">{headline}</Text>
            <Text variant="label" tone="on-accent-solid">{sub}</Text>
          </Box>
        </Row>
        {summary.savingCents > 0 ? (
          <Row justify="between" gap="md">
            <Box grow><Text variant="label" tone="on-accent-solid">Cheapest chain per item saves up to</Text></Box>
            <Text variant="title" tone="on-accent-solid">{formatCents(summary.savingCents)}</Text>
          </Row>
        ) : null}
      </Box>
    </HeroCard>
  );
}

function ItemCard({ group: g }: { group: PriceGroup }) {
  const rows = rankPrices(g.prices);
  const saving = itemSaving(g.prices);
  return (
    <Card gap="md">
      <Row justify="between" gap="sm">
        <Box grow><Text variant="subheading" level={3}>{g.name}</Text></Box>
        <Badge label={`per ${g.pack}`} />
      </Row>
      <Box gap="sm">
        {rows.map(({ price: pr, isCheapest, extraCents }, i) => (
          <ChainPriceRow
            key={`${pr.chain}-${pr.source}-${pr.product_name}-${i}`}
            chain={pr.chain}
            detail={detailOf(pr)}
            note={pr.valid_until ? `Until ${formatDate(pr.valid_until)}` : undefined}
            priceText={formatCents(pr.price_cents)}
            extraText={isCheapest ? undefined : extraText(extraCents)}
            isCheapest={isCheapest}
            isOffer={pr.is_offer}
            accessibilityLabel={`${chainLabel(pr.chain)} ${formatCents(pr.price_cents)} for ${g.name}${isCheapest ? ", cheapest" : ""}${pr.is_offer ? ", offer" : ""}${pr.valid_until ? `, until ${formatDate(pr.valid_until)}` : ""}`}
          />
        ))}
      </Box>
      {saving.cents > 0 && saving.versus ? (
        <Text variant="label" tone="success">{`Save ${formatCents(saving.cents)} compared with ${chainLabel(saving.versus)}`}</Text>
      ) : rows.length === 1 ? (
        <Text variant="caption" tone="muted">Only one chain has a price so far.</Text>
      ) : null}
    </Card>
  );
}

/** Product name, plus the shelf price when it differs from the price of the reference pack. */
function detailOf(p: Price): string {
  return p.shelf_price_cents !== p.price_cents ? `${p.product_name} · ${formatCents(p.shelf_price_cents)} on the shelf` : p.product_name;
}
