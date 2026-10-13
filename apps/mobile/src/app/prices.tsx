import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, Text as RNText, View } from "react-native";

import type { Price } from "@/api/client";
import { useApi } from "@/api/config";
import { ChainPriceRow } from "@/components/grocery/ChainPriceRow";
import { Avatar, Badge, EmptyState, Money, Panel, SkeletonCards, Subtitle, space, useTones } from "@/components/grocery/primitives";
import { ChunkyButton, Searchbar, Snackbar, Text } from "@/components/kit";
import { Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";
import { chainTint, extraText, initials, itemSaving, rankPrices, summarizePrices, type PriceGroup } from "@/groceryView";
import { chainLabel, useScreenData } from "@/hooks";
import { usePalette } from "@/theme";

export default function Prices() {
  const { api, loaded } = useApi();
  const c = useColors();
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
    return [...byItem.values()]
      .map((g) => ({ ...g, prices: [...g.prices].sort((a, b) => a.price_cents - b.price_cents) }))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
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
      setNotice(
        failed.length
          ? `${r.stored} prices. ${failed.length} source(s) failed: ${failed.map((f) => f.name).join(", ")}`
          : `${r.stored} prices updated`,
      );
      await reload();
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  }, [api, reload]);

  if (!loaded) return <Screen><Loading /></Screen>;

  const loading = !data && !error;
  const empty = !!data && data.length === 0;

  return (
    <Screen>
      <Title>Prices</Title>
      {api ? <Subtitle>Which chain is cheapest, item by item.</Subtitle> : null}
      {!api ? (
        <NeedsSetup />
      ) : (
        <FlatList
          data={empty || loading ? [] : groups}
          keyExtractor={(g) => g.item}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: space.xl }}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={reload} />}
          ListHeaderComponent={
            <View>
              {!empty && !loading ? <Hero summary={summary} /> : null}
              {!empty ? (
                <>
                  <View style={{ flexDirection: "row", gap: space.sm, marginBottom: space.md }}>
                    <View style={{ flex: 1 }}>
                      <ChunkyButton
                        label={refreshing ? "Refreshing…" : "Refresh"}
                        icon="refresh"
                        onPress={refresh}
                        disabled={refreshing}
                        accessibilityLabel="Refresh prices"
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <ChunkyButton label="Scan" icon="barcode-scan" outline onPress={() => router.push("/scan")} accessibilityLabel="Scan a barcode" />
                    </View>
                  </View>
                  <Searchbar
                    placeholder="Search items"
                    accessibilityLabel="Search items"
                    value={query}
                    onChangeText={setQuery}
                    style={{ marginBottom: space.md }}
                  />
                </>
              ) : null}
              {error ? <Text style={{ color: c.bad, marginBottom: space.sm }}>{error}</Text> : null}
              {loading ? <SkeletonCards count={3} label="Loading prices" /> : null}
            </View>
          }
          ListEmptyComponent={
            loading ? undefined : empty ? (
              <EmptyState
                mood="worried"
                title="No prices yet"
                body="Set up price sources on the server (see docs/PRICES.md), then fetch the first prices."
                actionLabel={refreshing ? "Refreshing…" : "Refresh prices"}
                actionIcon="refresh"
                onAction={refresh}
              />
            ) : (
              <Text variant="bodyMedium" style={{ color: c.muted, textAlign: "center", marginTop: space.lg }}>
                {`Nothing matches “${query.trim()}”.`}
              </Text>
            )
          }
          renderItem={({ item: g }) => <ItemCard group={g} />}
        />
      )}
      <Snackbar visible={!!notice} onDismiss={() => setNotice(null)} duration={5000}>
        {notice ?? ""}
      </Snackbar>
    </Screen>
  );
}

/** The top card: which chain wins most items and what choosing well saves. */
function Hero({ summary }: { summary: ReturnType<typeof summarizePrices> }) {
  const p = usePalette();
  if (summary.compared === 0) return null;
  const leader = summary.leader;
  const topCount = summary.wins[0]?.count ?? 0;
  const names = summary.top.map(chainLabel);
  const headline = names.join(" & ");
  const sub = leader
    ? `cheapest for ${leader.count} of ${summary.compared} compared items`
    : `level: each cheapest for ${topCount} of ${summary.compared} compared items`;
  return (
    <View
      accessible
      accessibilityLabel={`${leader ? `${headline} is cheapest, ${sub}` : `${headline}, ${sub}`}. Choosing the cheapest chain per item saves up to ${formatCents(summary.savingCents)}.`}
      style={{ backgroundColor: p.accent, borderRadius: 24, borderBottomWidth: 6, borderBottomColor: p.accentEdge, padding: space.lg, marginBottom: space.lg }}
    >
      <RNText style={{ color: p.onAccent, fontSize: 12, fontWeight: "800", letterSpacing: 1, textTransform: "uppercase" }}>Best chain right now</RNText>
      <View style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: space.sm }}>
        <View style={{ flexDirection: "row" }}>
          {summary.top.slice(0, 3).map((chain, i) => (
            <View key={chain} style={{ marginLeft: i === 0 ? 0 : -12, borderRadius: 28, borderWidth: 3, borderColor: p.accent }}>
              <Avatar tint={chainTint(chain)} label={initials(chainLabel(chain))} size={48} />
            </View>
          ))}
        </View>
        <View style={{ flex: 1 }}>
          <RNText style={{ color: p.onAccent, fontSize: 26, fontWeight: "800" }}>{headline}</RNText>
          <RNText style={{ color: p.onAccent, fontSize: 14 }}>{sub}</RNText>
        </View>
      </View>
      {summary.savingCents > 0 ? (
        <View style={{ marginTop: space.lg, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md }}>
          <RNText style={{ color: p.onAccent, fontSize: 14, flex: 1 }}>Cheapest chain per item saves up to</RNText>
          <Money text={formatCents(summary.savingCents)} size="xl" color={p.onAccent} />
        </View>
      ) : null}
    </View>
  );
}

function ItemCard({ group: g }: { group: PriceGroup }) {
  const tones = useTones();
  const p = usePalette();
  const rows = rankPrices(g.prices);
  const saving = itemSaving(g.prices);
  return (
    <Panel>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.sm, marginBottom: space.md }}>
        <Text variant="titleMedium" style={{ flex: 1 }} accessibilityRole="header">
          {g.name}
        </Text>
        <Badge tone="muted" label={`per ${g.pack}`} />
      </View>
      <View style={{ gap: space.sm }}>
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
            accessibilityLabel={`${chainLabel(pr.chain)} ${formatCents(pr.price_cents)} for ${g.name}${isCheapest ? ", cheapest" : ""}${pr.is_offer ? ", offer" : ""}${
              pr.valid_until ? `, until ${formatDate(pr.valid_until)}` : ""
            }`}
          />
        ))}
      </View>
      {saving.cents > 0 && saving.versus ? (
        <RNText style={{ color: tones.good.fg, fontSize: 13, fontWeight: "700", marginTop: space.md }}>
          {`Save ${formatCents(saving.cents)} compared with ${chainLabel(saving.versus)}`}
        </RNText>
      ) : rows.length === 1 ? (
        <RNText style={{ color: p.muted, fontSize: 13, marginTop: space.md }}>Only one chain has a price so far.</RNText>
      ) : null}
    </Panel>
  );
}

/** Product name, plus the shelf price when it differs from the price of the reference pack. */
function detailOf(p: Price): string {
  return p.shelf_price_cents !== p.price_cents ? `${p.product_name} · ${formatCents(p.shelf_price_cents)} on the shelf` : p.product_name;
}
