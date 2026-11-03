import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { BarChart, Box, Chip, ChipRow, Group, HeroCaption, HeroCard, HeroChip, HeroFigure, IconButton, Money, Note, Section, Text, VirtualList } from "@financer/ui";

import type { Split, Transaction } from "@/api/client";
import { useApi } from "@/api/config";
import { CategorizationTools } from "@/components/CategorizationTools";
import { Page } from "@/components/Page";
import { RecategorizeSheet } from "@/components/RecategorizeSheet";
import { SectionSwitch } from "@/components/SectionSwitch";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { TransactionRow } from "@/components/TransactionRow";
import { peakText, spendingTrend, trendSummary } from "@/charts";
import { dayHeading, spokenMoney } from "@/format";
import { pickFileBytes } from "@/native/files";
import { localIsoDate } from "@/period";
import { TX_FILTERS, dayTotal, emptyFilterText, filterTx, type TxFilter } from "@/spendingView";

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
  const [items, setItems] = useState<Transaction[]>([]);
  const [busy, setBusy] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [splits, setSplits] = useState<Split[]>([]);
  const [selected, setSelected] = useState<Transaction | null>(null);
  const [filter, setFilter] = useState<TxFilter>("all");

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
  const groups = useMemo(() => groupByDay(filterTx(items, filter)), [items, filter]);
  const splitIds = useMemo(() => new Set(splits.map((s) => s.transaction_id)), [splits]);
  const trend = useMemo(() => spendingTrend(items, today, TREND_DAYS), [items, today]);

  if (!loaded) return <Page title="Spending"><Loading /></Page>;
  if (!api) return <Page title="Spending"><SectionSwitch /><NeedsSetup /></Page>;

  const summary = trendSummary(trend, TREND_DAYS);
  const peak = peakText(trend);
  const delta = trend.deltaPercent;
  const sentence = `${summary}${peak ? ` ${peak}.` : ""}`;

  return (
    <Page
      title="Spending"
      subtitle={items.length > 0 ? `${items.length} bookings` : undefined}
      fixed
      actions={
        <>
          <IconButton icon="bank-transfer" label="Sync with Sparkasse" onPress={() => router.push("/sync")} />
          <IconButton icon="storefront-outline" label="Spending by store" onPress={() => router.push("/stores")} />
          <IconButton icon="file-delimited-outline" label="Import Sparkasse CSV" onPress={() => void importCsv()} disabled={busy} />
        </>
      }
    >
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
      <VirtualList
        data={groups}
        keyExtractor={(g) => g.date}
        refreshing={busy && fetched}
        onRefresh={load}
        gap="lg"
        header={
          <Box gap="md">
            <SectionSwitch />
            {items.length > 0 ? (
              <>
                <HeroCard label={`Spent, last ${TREND_DAYS} days`} chip={delta !== null && delta !== 0 ? <HeroChip icon={delta > 0 ? "trending-up" : "trending-down"} text={`${Math.abs(delta)} % ${delta > 0 ? "more" : "less"}`} /> : null}>
                  <HeroFigure cents={trend.total} label={`Spent ${spokenMoney(trend.total)} in the last ${TREND_DAYS} days`} />
                  <BarChart values={trend.series} highlight={trend.peak} summary={sentence} onCard />
                  <HeroCaption>{sentence}</HeroCaption>
                </HeroCard>
                <ChipRow>
                  {TX_FILTERS.map((f) => (
                    <Chip key={f.value} label={f.label} selected={filter === f.value} onPress={() => setFilter(f.value)} />
                  ))}
                </ChipRow>
              </>
            ) : null}
            {message ? <Note>{message}</Note> : null}
          </Box>
        }
        footer={groups.length > 0 ? <CategorizationTools onChanged={(note) => void load().then(() => setMessage(note))} /> : undefined}
        empty={
          !fetched ? (
            <Loading rows={5} />
          ) : items.length > 0 ? (
            <Text variant="body" tone="muted">{emptyFilterText(filter)}</Text>
          ) : (
            <Empty
              title="No transactions yet"
              message="Import a CSV export from Sparkasse online banking, or sync your account, and your spending shows up here."
              actionLabel="Import Sparkasse CSV"
              actionIcon="file-delimited-outline"
              onAction={() => void importCsv()}
            />
          )
        }
        renderItem={(g) => (
          <Section title={dayHeading(g.date, today)}>
            <Group>
              {g.items.map((t) => (
                <TransactionRow key={t.id} item={t} split={splitIds.has(t.id)} onPress={() => setSelected(t)} />
              ))}
            </Group>
            <Money cents={dayTotal(g.items)} variant="caption" signed tone="muted" />
          </Section>
        )}
      />
    </Page>
  );
}
