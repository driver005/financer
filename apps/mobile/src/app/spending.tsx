import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, Text as RNText, View } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";

import type { Split, Transaction } from "@/api/client";
import { useApi } from "@/api/config";
import { BarChart } from "@/components/Charts";
import { CategorizationTools } from "@/components/CategorizationTools";
import { EmptyState } from "@/components/EmptyState";
import { ChunkyButton } from "@/components/kit";
import { Money } from "@/components/Money";
import { RecategorizeSheet } from "@/components/RecategorizeSheet";
import { ListGroup, SectionHeader, StatusPill } from "@/components/rows";
import { SkeletonList } from "@/components/Skeleton";
import { TransactionRow } from "@/components/TransactionRow";
import { Card, Loading, NeedsSetup, Screen, Title } from "@/components/ui";
import { peakText, spendingTrend, trendSummary } from "@/charts";
import { dayHeading, spokenMoney } from "@/format";
import { pickFileBytes } from "@/native/files";
import { localIsoDate } from "@/period";
import { space, typography, usePalette } from "@/theme";

const TREND_DAYS = 14;

type DayGroup = { date: string; items: Transaction[] };

/** Consecutive transactions of the same booking day (the server returns them newest first). */
function groupByDay(items: Transaction[]): DayGroup[] {
  const groups: DayGroup[] = [];
  for (const t of items) {
    const last = groups[groups.length - 1];
    if (last && last.date === t.booking_date) last.items.push(t);
    else groups.push({ date: t.booking_date, items: [t] });
  }
  return groups;
}

export default function Spending() {
  const { api, loaded } = useApi();
  const router = useRouter();
  const p = usePalette();
  const [items, setItems] = useState<Transaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [splits, setSplits] = useState<Split[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);

  const load = useCallback(async () => {
    if (!api) return;
    setBusy(true);
    try {
      setItems(await api.transactions());
      setSplits(await api.splits());
      setMessage(null);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not load transactions");
    } finally {
      setBusy(false);
      setFetched(true);
    }
  }, [api]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const importCsv = useCallback(async () => {
    if (!api) return;
    try {
      const bytes = await pickFileBytes(["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain"]);
      if (bytes === null) return;
      setBusy(true);
      const r = await api.importCsv(bytes);
      const skipped = r.skipped.length ? `, ${r.skipped.length} unreadable` : "";
      setMessage(`Imported ${r.imported} new, ${r.duplicates} already known${skipped}`);
      setItems(await api.transactions());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }, [api]);

  const today = localIsoDate();
  const groups = useMemo(() => groupByDay(items), [items]);
  const splitIds = useMemo(() => new Set(splits.map((s) => s.transaction_id)), [splits]);
  const trend = useMemo(() => spendingTrend(items, today, TREND_DAYS), [items, today]);

  if (!loaded) return <Screen><Loading /></Screen>;

  const summary = trendSummary(trend, TREND_DAYS);
  const peak = peakText(trend);
  const delta = trend.deltaPercent;

  const header = (
    <View>
      {items.length > 0 ? (
        <Card>
          <RNText style={[typography.overline, { color: p.muted }]}>Spent, last {TREND_DAYS} days</RNText>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, flexWrap: "wrap", marginTop: space.xs }}>
            <Money cents={trend.total} variant="display" tone="plain" style={{ fontSize: 36, lineHeight: 42 }} label={`Spent ${spokenMoney(trend.total)} in the last ${TREND_DAYS} days`} />
            {delta !== null && delta !== 0 ? (
              <StatusPill
                tone={delta > 0 ? "warn" : "good"}
                icon={delta > 0 ? "trending-up" : "trending-down"}
                label={`${Math.abs(delta)} % ${delta > 0 ? "more" : "less"}`}
                accessibilityLabel={`${Math.abs(delta)} percent ${delta > 0 ? "more" : "less"} than the ${TREND_DAYS} days before`}
              />
            ) : null}
          </View>
          <View style={{ marginTop: space.md }}>
            <BarChart values={trend.series} highlight={trend.peak} summary={`${summary}${peak ? ` ${peak}.` : ""}`} showSummary />
          </View>
        </Card>
      ) : null}

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm, marginBottom: space.md }}>
        <View style={{ flex: 1, minWidth: 150 }}>
          <ChunkyButton compact icon="bank-transfer" label="Sync bank" accessibilityLabel="Sync with Sparkasse" onPress={() => router.push("/sync")} />
        </View>
        <View style={{ flex: 1, minWidth: 150 }}>
          <ChunkyButton compact outline icon="storefront-outline" label="By store" accessibilityLabel="Spending by store" onPress={() => router.push("/stores")} />
        </View>
        <View style={{ flex: 1, minWidth: 150 }}>
          <ChunkyButton compact outline icon="file-delimited-outline" label="Import CSV" accessibilityLabel="Import Sparkasse CSV" onPress={() => void importCsv()} disabled={busy} />
        </View>
      </View>
      {message ? (
        <RNText accessibilityLiveRegion="polite" style={[typography.caption, { color: p.muted, marginBottom: space.md, paddingHorizontal: space.xs }]}>
          {message}
        </RNText>
      ) : null}

      <CategorizationTools onChanged={(note) => void load().then(() => setMessage(note))} />
    </View>
  );

  return (
    <Screen>
      <Title subtitle={items.length > 0 ? `${items.length} bookings` : undefined}>Spending</Title>
      {!api ? (
        <NeedsSetup />
      ) : (
        <>
          <RecategorizeSheet
            tx={selected}
            split={splits.find((s) => s.transaction_id === selected?.id)}
            onClose={() => setSelected(null)}
            onChanged={async (note) => {
              setSelected(null);
              await load();
              setMessage(note);
            }}
          />
          <FlatList
            data={groups}
            keyExtractor={(g) => g.date}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: space.xl }}
            refreshControl={<RefreshControl refreshing={busy && fetched} onRefresh={load} tintColor={p.accent} />}
            ListHeaderComponent={header}
            ListEmptyComponent={
              !fetched ? (
                <SkeletonList rows={5} />
              ) : (
                <EmptyState
                  title="No transactions yet"
                  message="Import a CSV export from Sparkasse online banking, or sync your account, and your spending shows up here."
                  actionLabel="Import Sparkasse CSV"
                  actionIcon="file-delimited-outline"
                  onAction={() => void importCsv()}
                />
              )
            }
            renderItem={({ item: g }) => (
              <View>
                <SectionHeader title={dayHeading(g.date, today)} />
                <ListGroup inset={68}>
                  {g.items.map((t) => (
                    <TransactionRow key={t.id} item={t} split={splitIds.has(t.id)} onPress={() => setSelected(t)} />
                  ))}
                </ListGroup>
              </View>
            )}
          />
        </>
      )}
    </Screen>
  );
}
