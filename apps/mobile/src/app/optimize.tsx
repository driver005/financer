import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text as RNText, View } from "react-native";
import { useRouter } from "expo-router";
import { Badge, Button, Card, Empty, IconButton, Note, Screen, SectionTitle, Text } from "../ui/primitives";
import { tokens, useTheme } from "../ui/theme";
import { allPrices } from "../db/prices";
import { purchases } from "../db/purchases";
import { getStores } from "../db/money";
import { core } from "../rust/core";
import type { Store } from "../lib/types";

type PlanRow = {
  name: string; store: string; cents: number; savings: number;
  weekday: string; nextDate: string; buyNow: boolean;
};

const STORE_COLORS: Record<string, string> = {
  rewe: "#E2231A", kaufland: "#E30613", lidl: "#0050AA",
  aldi: "#005CA9", penny: "#D99700", netto: "#C9A200",
};

export default function OptimizeScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [stores, setStores] = useState<Store[]>([]);
  const [selected, setSelected] = useState<string[]>(["rewe", "lidl", "aldi"]);
  const [plan, setPlan] = useState<PlanRow[] | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void getStores().then((rows) => { setStores(rows); setSelected(rows.slice(0, 3).map((s) => s.id)); });
  }, []);

  const run = useCallback(async () => {
    setBusy(true);
    try {
      const [prices, items] = await Promise.all([allPrices(), purchases()]);
      const unique = Array.from(new Map(items.map((i) => [i.name.toLowerCase(), { name: i.name }])).values());
      setPlan(core.optimize(prices, unique, selected) as PlanRow[]);
    } finally {
      setBusy(false);
    }
  }, [selected]);

  const toggle = (id: string) => setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);
  const totalSavings = (plan ?? []).reduce((sum, row) => sum + row.savings, 0);

  return (
    <Screen
      title="Best prices"
      subtitle="Cheapest discounter per item, computed locally"
      back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
    >
      <Card>
        <SectionTitle>Choose discounters</SectionTitle>
        <Text variant="caption" color="muted">Only these chains are compared. Prices and forecasts stay on this device.</Text>
        <View style={styles.stores}>
          {stores.map((store) => (
            <Badge key={store.id} label={store.name} tone={selected.includes(store.id) ? "accent" : undefined} />
          ))}
        </View>
        <View style={styles.storeButtons}>
          {stores.map((store) => (
            <Button
              key={store.id}
              label={selected.includes(store.id) ? `✓ ${store.name}` : store.name}
              tone={selected.includes(store.id) ? "accent" : "secondary"}
              onPress={() => toggle(store.id)}
            />
          ))}
        </View>
        <Button label={busy ? "Calculating…" : "Generate best-buy plan"} icon="auto-fix" onPress={() => void run()} disabled={!selected.length || busy} />
      </Card>

      {plan && plan.length > 0 ? (
        <>
          <Card tone="accent">
            <Text variant="number">{core.formatEuro(totalSavings)}</Text>
            <Text variant="label" color="muted">Saved versus the most expensive of the selected chains</Text>
          </Card>
          <SectionTitle>What to buy where</SectionTitle>
          {plan.map((row) => (
            <Card key={row.name}>
              <View style={styles.row}>
                <View style={[styles.monogram, { backgroundColor: STORE_COLORS[row.store] ?? colors.accent }]}>
                  <RNText style={styles.monogramText}>{(stores.find((s) => s.id === row.store)?.name ?? row.store).slice(0, 1)}</RNText>
                </View>
                <View style={styles.grow}>
                  <Text variant="subheading">{row.name}</Text>
                  <Text variant="caption" color="muted">{stores.find((s) => s.id === row.store)?.name ?? row.store} · {core.formatEuro(row.cents)}</Text>
                  <Text variant="caption" color="muted">{`Probably cheapest on ${row.weekday} (${row.nextDate})`}</Text>
                </View>
                <View style={styles.right}>
                  {row.buyNow ? <Badge label="BUY NOW" tone="success" /> : <Badge label="WAIT" tone="offer" />}
                  {row.savings > 0 ? <Text variant="caption" color="success">{`save ${core.formatEuro(row.savings)}`}</Text> : null}
                </View>
              </View>
            </Card>
          ))}
          <Note tone="muted">Forecasts come from your local price history, including sample prices until you add your own.</Note>
        </>
      ) : plan ? (
        <Empty title="No prices yet" message="Add items under Shops and prices on each item, then run the plan again." />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  stores: { flexDirection: "row", flexWrap: "wrap", gap: tokens.xs },
  storeButtons: { flexDirection: "row", flexWrap: "wrap", gap: tokens.sm },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.md },
  grow: { flex: 1, gap: 2 },
  right: { alignItems: "flex-end", gap: 4 },
  monogram: { width: 42, height: 42, borderRadius: 14, alignItems: "center", justifyContent: "center" },
  monogramText: { color: "#FFFFFF", fontFamily: tokens.serif, fontSize: 20, fontWeight: "600" },
});
