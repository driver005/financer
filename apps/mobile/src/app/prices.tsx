import { router } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { Chip, List, Searchbar, Snackbar, Text } from "@/components/kit";

import type { Price } from "@/api/client";
import { useApi } from "@/api/config";
import { Body, Button, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";
import { chainLabel, useScreenData } from "@/hooks";

type Group = { item: string; name: string; pack: string; prices: Price[] };

export default function Prices() {
  const { api, loaded } = useApi();
  const c = useColors();
  const { data, error, busy, reload } = useScreenData((a) => a.prices());
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const groups = useMemo<Group[]>(() => {
    const byItem = new Map<string, Group>();
    for (const p of data ?? []) {
      const g = byItem.get(p.item) ?? { item: p.item, name: p.item_name, pack: p.reference_pack, prices: [] };
      g.prices.push(p);
      byItem.set(p.item, g);
    }
    const q = query.trim().toLowerCase();
    return [...byItem.values()]
      .map((g) => ({ ...g, prices: [...g.prices].sort((a, b) => a.price_cents - b.price_cents) }))
      .filter((g) => !q || g.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "de"));
  }, [data, query]);

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

  return (
    <Screen>
      <Title>Prices</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <>
          <Button label={refreshing ? "Refreshing…" : "Refresh prices"} icon="refresh" onPress={refresh} disabled={refreshing} />
          <View style={{ height: 8 }} />
          <Button label="Scan a barcode" icon="barcode-scan" mode="outlined" onPress={() => router.push("/scan")} />
          <Searchbar placeholder="Search items" accessibilityLabel="Search items" value={query} onChangeText={setQuery} style={{ marginVertical: 12 }} />
          {error ? <Text style={{ color: c.bad, marginBottom: 8 }}>{error}</Text> : null}
          <FlatList
            data={groups}
            keyExtractor={(g) => g.item}
            refreshControl={<RefreshControl refreshing={busy} onRefresh={reload} />}
            ListEmptyComponent={
              busy ? undefined : (
                <Card>
                  <Body bold>No prices yet</Body>
                  <Text variant="bodyMedium" style={{ color: c.muted, marginTop: 4 }}>
                    Configure price sources on the server (see docs/PRICES.md), then tap Refresh prices.
                  </Text>
                </Card>
              )
            }
            renderItem={({ item: g }) => (
              <Card>
                <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                  <Text variant="titleMedium">{g.name}</Text>
                  <Text variant="bodySmall" style={{ color: c.muted }}>per {g.pack}</Text>
                </View>
                {g.prices.map((p, i) => (
                  <List.Item
                    key={`${p.chain}-${p.source}-${p.product_name}-${i}`}
                    title={`${chainLabel(p.chain)} · ${formatCents(p.price_cents)}`}
                    description={`${p.product_name} (${formatCents(p.shelf_price_cents)} on the shelf)${
                      p.valid_until ? ` · until ${formatDate(p.valid_until)}` : ""
                    }`}
                    left={() => <List.Icon icon={i === 0 ? "star" : "store-outline"} color={i === 0 ? c.good : undefined} />}
                    right={() => (p.is_offer ? <Chip compact>Offer</Chip> : null)}
                    accessibilityLabel={`${chainLabel(p.chain)} ${formatCents(p.price_cents)} for ${g.name}${i === 0 ? ", cheapest" : ""}`}
                  />
                ))}
              </Card>
            )}
          />
        </>
      )}
      <Snackbar visible={!!notice} onDismiss={() => setNotice(null)} duration={5000}>
        {notice ?? ""}
      </Snackbar>
    </Screen>
  );
}
