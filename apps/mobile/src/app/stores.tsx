import { MaterialCommunityIcons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text as RNText, View } from "react-native";

import type { Split, StoreSpend, StoreSpending, Transaction } from "@/api/client";
import { useApi } from "@/api/config";
import { RecategorizeSheet } from "@/components/RecategorizeSheet";
import { TransactionRow } from "@/components/TransactionRow";
import { SegmentedButtons } from "@/components/kit";
import { Badge } from "@/components/Watchdog";
import { Bar, Body, Card, Loading, NeedsSetup, Screen, Title, useColors } from "@/components/ui";
import { formatCents } from "@/format";
import { localIsoDate, periodLabel } from "@/period";
import {
  STORES_VIEWS,
  barFraction,
  changeText,
  changeTone,
  compareText,
  formatPermille,
  lastVisitText,
  rankedRows,
  rowLabel,
  totalText,
  unmatchedHint,
  viewQuery,
  visitsText,
  type ChangeTone,
  type StoresView,
} from "@/stores";

type Visits = { loading: boolean; items: Transaction[]; error?: string };

/** What I spend at each supermarket: ranked chains for a budget period, tap one for its visits. */
export default function Stores() {
  const { api, loaded } = useApi();
  const c = useColors();
  const [view, setView] = useState<StoresView>("current");
  const [data, setData] = useState<StoreSpending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpenState] = useState<string | null>(null);
  // read by `load`, so that opening a row does not reload the whole screen
  const openRef = useRef<string | null>(null);
  const [visits, setVisits] = useState<Record<string, Visits>>({});
  const [splits, setSplits] = useState<Split[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const today = localIsoDate();

  function setOpen(chain: string | null) {
    openRef.current = chain;
    setOpenState(chain);
  }

  const loadVisits = useCallback(
    async (chain: string, which: StoresView) => {
      if (!api) return;
      setVisits((v) => ({ ...v, [chain]: { loading: true, items: v[chain]?.items ?? [] } }));
      try {
        const q = viewQuery(which);
        const [items, sp] = await Promise.all([api.storeTransactions(chain, q.period, { n: q.n, date: localIsoDate() }), api.splits()]);
        setSplits(sp);
        setVisits((v) => ({ ...v, [chain]: { loading: false, items } }));
      } catch (e) {
        setVisits((v) => ({ ...v, [chain]: { loading: false, items: [], error: e instanceof Error ? e.message : "Could not load the visits" } }));
      }
    },
    [api],
  );

  const load = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      const q = viewQuery(view);
      setData(await api.storeSpending(q.period, { n: q.n, date: localIsoDate() }));
      setError(null);
      if (openRef.current) void loadVisits(openRef.current, view);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the store spending");
    } finally {
      setBusy(false);
    }
  }, [api, view, loadVisits]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  function choose(next: StoresView) {
    setView(next);
    setOpen(null);
    setVisits({});
  }

  function toggle(row: StoreSpend) {
    if (open === row.chain) {
      setOpen(null);
      return;
    }
    setOpen(row.chain);
    void loadVisits(row.chain, view);
  }

  if (!loaded) return <Screen><Loading /></Screen>;

  const rows = data ? rankedRows(data) : [];
  const tone: Record<ChangeTone, "bad" | "good" | "muted" | "warn"> = { up: "bad", down: "good", flat: "muted", new: "warn" };
  const hint = data ? unmatchedHint(data) : null;

  return (
    <Screen>
      <Title>Stores</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <ScrollView
          contentContainerStyle={{ paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={busy} onRefresh={load} />}
        >
          <SegmentedButtons
            value={view}
            onValueChange={choose}
            buttons={STORES_VIEWS.map((v) => ({ value: v.value, label: v.label }))}
          />
          <View style={{ height: 12 }} />

          {error ? <Body muted>{error}</Body> : null}
          {!data && !error ? <Loading /> : null}
          {note ? <RNText style={{ color: c.muted, marginBottom: 8 }}>{note}</RNText> : null}

          {data ? (
            <>
              <Card>
                <RNText style={{ color: c.muted, fontSize: 13, fontWeight: "600" }}>
                  {periodLabel({ start: data.start, end: data.end })}
                </RNText>
                <RNText
                  accessibilityLabel={`Spent in stores: ${formatCents(data.total_cents)}`}
                  style={{ color: c.text, fontSize: 30, fontWeight: "900", marginTop: 4 }}
                >
                  {formatCents(data.total_cents)}
                </RNText>
                <RNText style={{ color: c.muted, fontSize: 13, marginTop: 2 }}>{totalText(data)}</RNText>
                {data.previous_total_cents > 0 || data.total_cents > 0 ? (
                  <RNText style={{ color: c.muted, fontSize: 12, marginTop: 6 }}>Compared with {compareText(data)}</RNText>
                ) : null}
              </Card>

              {rows.length === 0 ? (
                <Card>
                  <Body muted>
                    No store spending in this period yet. Import or sync your bank transactions on the Spending tab; chains such as
                    Lidl, Aldi, Rewe or Kaufland are recognized from the booking text.
                  </Body>
                </Card>
              ) : null}

              {rows.map((row) => {
                const isOpen = open === row.chain;
                const v = visits[row.chain];
                const last = lastVisitText(row.last_visit, today);
                return (
                  <Card key={row.chain}>
                    <Pressable
                      onPress={() => toggle(row)}
                      accessibilityRole="button"
                      accessibilityLabel={`${rowLabel(row)}. ${isOpen ? "Hide" : "Show"} the visits`}
                      accessibilityState={{ expanded: isOpen }}
                    >
                      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
                        <RNText style={{ color: c.text, fontSize: 18, fontWeight: "800", flex: 1 }} numberOfLines={1}>
                          {row.name}
                        </RNText>
                        <RNText style={{ color: c.text, fontSize: 18, fontWeight: "800" }}>{formatCents(row.total_cents)}</RNText>
                        <MaterialCommunityIcons name={isOpen ? "chevron-up" : "chevron-down"} size={22} color={c.muted} />
                      </View>
                      <Bar progress={barFraction(row, rows)} height={12} />
                      <View style={{ flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
                        <RNText style={{ color: c.text, fontWeight: "800" }}>{formatPermille(row.share_permille)}</RNText>
                        <RNText style={{ color: c.muted }}>
                          {visitsText(row.visits)}
                          {row.visits > 0 ? ` · ⌀ ${formatCents(row.average_basket_cents)}` : ""}
                          {last ? ` · ${last}` : ""}
                        </RNText>
                        <Badge text={changeText(row)} tone={tone[changeTone(row)]} />
                      </View>
                    </Pressable>

                    {isOpen ? (
                      <View style={{ marginTop: 12, borderTopWidth: 2, borderTopColor: c.border, paddingTop: 8 }}>
                        {v?.loading && v.items.length === 0 ? <Loading /> : null}
                        {v?.error ? <Body muted>{v.error}</Body> : null}
                        {v && !v.loading && !v.error && v.items.length === 0 ? <Body muted>No bookings in this range.</Body> : null}
                        {v?.items.map((t) => (
                          <TransactionRow key={t.id} item={t} split={splits.some((s) => s.transaction_id === t.id)} onPress={() => setSelected(t)} />
                        ))}
                      </View>
                    ) : null}
                  </Card>
                );
              })}

              {hint ? <RNText style={{ color: c.muted, fontSize: 13, marginTop: 4 }}>{hint}</RNText> : null}
              <RNText style={{ color: c.muted, fontSize: 12, marginTop: 8 }}>
                Counts expenses only, one visit per booking. Refunds are not subtracted.
              </RNText>
            </>
          ) : null}
        </ScrollView>
      )}

      <RecategorizeSheet
        tx={selected}
        split={splits.find((s) => s.transaction_id === selected?.id)}
        onClose={() => setSelected(null)}
        onChanged={async (message) => {
          setSelected(null);
          setNote(message);
          await load();
        }}
      />
    </Screen>
  );
}
