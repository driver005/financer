import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, Text as RNText, View } from "react-native";
import Svg, { Line, Polyline } from "react-native-svg";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Badge, Button, Card, IconButton, Note, Screen, SectionTitle, Segmented, Text, TextField } from "../ui/primitives";
import { tokens, useTheme } from "../ui/theme";
import { shoppingItem } from "../db/shopping";
import { allPrices, addPrice, type PriceRow } from "../db/prices";
import { getStores } from "../db/money";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import type { ShoppingItem, Store } from "../lib/types";

const STORE_COLORS: Record<string, string> = {
  rewe: "#E2231A", kaufland: "#E30613", lidl: "#0050AA",
  aldi: "#005CA9", penny: "#D99700", netto: "#C9A200",
};

type Stats = { current: number; min: number; max: number; avg: number; series: { date: string; cents: number }[] };
type Forecast = { weekday: string; nextDate: string; expectedCents: number; buyNow: boolean; samples: number };

const WIDTH = 340;
const HEIGHT = 180;
const PAD = 16;

export default function ItemScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const [item, setItem] = useState<ShoppingItem | null>(null);
  const [prices, setPrices] = useState<PriceRow[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [stats, setStats] = useState<Record<string, Stats>>({});
  const [forecasts, setForecasts] = useState<Record<string, Forecast>>({});
  const [active, setActive] = useState<string[]>(["rewe", "kaufland", "lidl", "aldi", "penny", "netto"]);
  const [entryStore, setEntryStore] = useState("rewe");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const found = await shoppingItem(Number(id));
    setItem(found);
    const [all, shopList] = await Promise.all([allPrices(), getStores()]);
    const name = found?.name ?? "";
    const relevant = all.filter((p) => p.name.toLowerCase() === name.toLowerCase());
    setPrices(relevant);
    setStores(shopList);
    const nextStats: Record<string, Stats> = {};
    const nextForecasts: Record<string, Forecast> = {};
    for (const store of shopList) {
      const series = relevant.filter((p) => p.storeId === store.id);
      if (!series.length) continue;
      nextStats[store.id] = core.priceStats(series, name, store.id) as Stats;
      nextForecasts[store.id] = core.forecast(series, name, store.id) as Forecast;
    }
    setStats(nextStats);
    setForecasts(nextForecasts);
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const savePrice = useCallback(async () => {
    if (!item) return;
    const cents = parseEuro(amount);
    if (cents === null) { setMessage("Enter an amount like 1,29."); return; }
    await addPrice({ storeId: entryStore, name: item.name, cents, date });
    setAmount("");
    setMessage("Price saved locally.");
    await load();
  }, [item, entryStore, amount, date, load]);

  const allValues = Object.values(stats).flatMap((s) => s.series.map((p) => p.cents));
  const globalMin = allValues.length ? Math.min(...allValues) : 0;
  const globalMax = allValues.length ? Math.max(...allValues) : 1;
  const span = Math.max(1, globalMax - globalMin);

  const lineFor = (storeId: string) => {
    const series = stats[storeId]?.series ?? [];
    if (!series.length) return "";
    const step = series.length > 1 ? (WIDTH - PAD * 2) / (series.length - 1) : 0;
    return series.map((p, i) => {
      const x = PAD + i * step;
      const y = HEIGHT - PAD - ((p.cents - globalMin) / span) * (HEIGHT - PAD * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
  };

  const best = Object.entries(stats)
    .filter(([storeId]) => active.includes(storeId))
    .sort((a, b) => a[1].current - b[1].current)[0];

  return (
    <Screen
      title={item?.name ?? "Item"}
      subtitle={item ? `${item.qty} · ${stores.find((s) => s.id === item.store)?.name ?? "any shop"}` : "Price history"}
      back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
    >
      {message ? <Note tone="success">{message}</Note> : null}

      <Card>
        <SectionTitle>Price curve</SectionTitle>
        <Text variant="caption" color="muted">Local price history per discounter. Green marks the cheapest current offer.</Text>
        <View style={styles.chart}>
          <Svg width={WIDTH} height={HEIGHT}>
            {[0, 1, 2, 3].map((i) => (
              <Line key={i} x1={PAD} x2={WIDTH - PAD} y1={PAD + i * ((HEIGHT - PAD * 2) / 3)} y2={PAD + i * ((HEIGHT - PAD * 2) / 3)} stroke={colors.border} strokeWidth={1} />
            ))}
            {stores.filter((s) => active.includes(s.id)).map((store) => (
              <Polyline key={store.id} points={lineFor(store.id)} stroke={STORE_COLORS[store.id] ?? colors.accent} strokeWidth={2.5} fill="none" strokeLinejoin="round" />
            ))}
          </Svg>
        </View>
        <View style={styles.legend}>
          {stores.filter((s) => active.includes(s.id)).map((store) => (
            <View key={store.id} style={styles.legendItem}>
              <View style={[styles.dot, { backgroundColor: STORE_COLORS[store.id] ?? colors.accent }]} />
              <RNText style={[styles.legendLabel, { color: colors.text }]}>{store.name}</RNText>
            </View>
          ))}
        </View>
        {best ? (
          <Note tone="success">{`Cheapest now: ${stores.find((s) => s.id === best[0])?.name ?? best[0]} at ${core.formatEuro(best[1].current)}`}</Note>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Show discounters</SectionTitle>
        <View style={styles.legend}>
          {stores.map((store) => (
            <Badge key={store.id} label={store.name} tone={active.includes(store.id) ? "accent" : undefined} />
          ))}
        </View>
        <Segmented
          value={active.length === stores.length ? "all" : "some"}
          onChange={(value) => setActive(value === "all" ? stores.map((s) => s.id) : ["rewe"])}
          options={[{ value: "all", label: "All chains" }, { value: "some", label: "REWE only" }]}
        />
      </Card>

      <SectionTitle>Prices by discounter</SectionTitle>
      {stores.filter((s) => active.includes(s.id)).map((store) => {
        const s = stats[store.id];
        const f = forecasts[store.id];
        if (!s) return null;
        return (
          <Card key={store.id}>
            <View style={styles.row}>
              <View style={[styles.monogram, { backgroundColor: STORE_COLORS[store.id] ?? colors.accent }]}>
                <RNText style={styles.monogramText}>{store.name.slice(0, 1)}</RNText>
              </View>
              <View style={styles.grow}>
                <Text variant="subheading">{store.name}</Text>
                <Text variant="caption" color="muted">{`now ${core.formatEuro(s.current)} · low ${core.formatEuro(s.min)} · avg ${core.formatEuro(s.avg)}`}</Text>
                {f ? <Text variant="caption" color="muted">{`Usually cheapest on ${f.weekday}; next ${f.nextDate}${f.buyNow ? " · buy now" : ""}`}</Text> : null}
              </View>
            </View>
          </Card>
        );
      })}

      <Card>
        <SectionTitle>Add a price</SectionTitle>
        <Text variant="caption" color="muted">Some curves start from local sample prices. Add your own to replace the picture.</Text>
        <Segmented value={entryStore} onChange={setEntryStore} options={stores.map((s) => ({ value: s.id, label: s.name }))} />
        <TextField label="Price" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="1,29" />
        <TextField label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        <Button label="Save price" icon="plus" onPress={() => void savePrice()} />
      </Card>
      {prices.filter((p) => p.source === "sample").length ? (
        <Note tone="muted">{`${prices.filter((p) => p.source === "sample").length} sample prices used for this item.`}</Note>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  chart: { alignItems: "center", paddingVertical: tokens.sm },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: tokens.sm },
  legendItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  legendLabel: { fontFamily: tokens.sans, fontSize: 11 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.md },
  grow: { flex: 1, gap: 2 },
  monogram: { width: 38, height: 38, borderRadius: 12, alignItems: "center", justifyContent: "center" },
  monogramText: { color: "#FFFFFF", fontFamily: tokens.serif, fontSize: 18, fontWeight: "600" },
});
