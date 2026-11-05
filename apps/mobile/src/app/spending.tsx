import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Badge, Balance, BarChart, Box, Card, Chip, ChipRow, Group, Note, QuickActions, Row, SearchBar, Section, Text, VirtualList } from "@financer/ui";

import type { Split, Transaction } from "@/api/client";
import { useApi } from "@/api/config";
import { CategorizationTools } from "@/components/CategorizationTools";
import { BankSetupSheet } from "@/components/BankSetupSheet";
import { Page } from "@/components/Page";
import { RecategorizeSheet } from "@/components/RecategorizeSheet";
import { SectionSwitch } from "@/components/SectionSwitch";
import { SourceSwitcher } from "@/components/SourceSwitcher";
import { Empty, Loading, NeedsSetup } from "@/components/Status";
import { TransactionRow } from "@/components/TransactionRow";
import { peakText, spendingTrend, trendSummary } from "@/charts";
import { dayHeading, formatMoney, spokenMoney } from "@/format";
import { defaultSource, needsSetup, type SourceId } from "@/bankSetup";
import { pickFileBytes } from "@/native/files";
import { localIsoDate } from "@/period";
import { useBankSources } from "@/useBankSources";
import { TX_FILTERS, dayTotal, emptyFilterText, filterTx, incomeSpent, searchTx, type TxFilter } from "@/spendingView";
import { CategoryCard } from "@/components/today/CategoryCard";

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
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<SourceId | null>(null);
  const [setup, setSetup] = useState<{ open: boolean; start?: SourceId }>({ open: false });

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
      const r = await api.importFile("csv", bytes);
      const skipped = r.skipped.length ? `, ${r.skipped.length} unreadable` : "";
      setMessage(`Imported ${r.imported} new, ${r.duplicates} already known${skipped}`);
      setItems(await api.transactions());
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }, [api]);

  const banks = useBankSources(
    useCallback(() => {
      void load();
    }, [load]),
  );
  const connections = banks.list ?? [];
  const activeSource = source ?? defaultSource(connections);

  const today = localIsoDate();
  const shown = useMemo(() => searchTx(filterTx(items, filter), query), [items, filter, query]);
  const groups = useMemo(() => groupByDay(shown), [shown]);
  const totals = useMemo(() => incomeSpent(shown), [shown]);
  // the span of what is listed, for the "Where it went" card (the list comes newest first)
  const span = useMemo(() => (shown.length ? { start: shown[shown.length - 1].booking_date, end: shown[0].booking_date } : null), [shown]);
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
    >
      <BankSetupSheet
        visible={setup.open}
        start={setup.start}
        list={connections}
        onClose={() => setSetup({ open: false })}
        onImportCsv={() => void importCsv()}
        onSaved={(id) => {
          setSetup({ open: false });
          setSource(id);
          void banks.load();
          setMessage("Saved. Press Connect to sign in to your bank.");
        }}
      />
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
                <Balance
                  label={`Spent, last ${TREND_DAYS} days`}
                  cents={trend.total}
                  spoken={`Spent ${spokenMoney(trend.total)} in the last ${TREND_DAYS} days`}
                  chip={delta !== null && delta !== 0 ? <Badge tone={delta > 0 ? "warning" : "success"} icon={delta > 0 ? "trending-up" : "trending-down"} label={`${Math.abs(delta)} % ${delta > 0 ? "more" : "less"} than before`} /> : undefined}
                  caption={peak ? `${peak}.` : undefined}
                />
                <BarChart values={trend.series} highlight={trend.peak} summary={sentence} />
              </>
            ) : null}
            <QuickActions
              actions={[
                { icon: "file-delimited-outline", label: "Import", onPress: () => void importCsv(), disabled: busy },
                { icon: "bank-transfer", label: "Sync", onPress: () => router.push("/sync") },
                { icon: "bank-plus", label: "Banks", onPress: () => setSetup({ open: true }) },
                { icon: "storefront-outline", label: "Stores", onPress: () => router.push("/stores") },
              ]}
            />
            {items.length > 0 ? (
              <>
                {shown.length > 0 ? (
                  <Row gap="md" align="stretch">
                    <Card tone="success" gap="2xs" fill>
                      <Text variant="label" tone="on-success-soft">Came in</Text>
                      <Text variant="price" tone="on-success-soft">{formatMoney(totals.income)}</Text>
                    </Card>
                    <Card tone="accent" gap="2xs" fill>
                      <Text variant="label" tone="on-accent-soft">Spent</Text>
                      <Text variant="price" tone="on-accent-soft">{formatMoney(totals.spent)}</Text>
                    </Card>
                  </Row>
                ) : null}
                {filter !== "income" && span ? <CategoryCard txs={shown} period={span} link={false} bubbles /> : null}
              </>
            ) : null}
            {banks.list !== null ? (
              <Section title="Sources" quiet>
                <SourceSwitcher
                  list={connections}
                  active={activeSource}
                  onChange={setSource}
                  onSetup={(id) => setSetup({ open: true, start: id })}
                  onImportCsv={() => void importCsv()}
                  importing={busy}
                  starting={banks.starting}
                  errors={banks.errors}
                  onStart={(c) => void banks.start(c)}
                  onCancel={(c) => void banks.cancel(c)}
                  onOpenLink={(c) => void banks.openLink(c)}
                />
              </Section>
            ) : null}
            {items.length > 0 ? (
              <>
                <SearchBar value={query} onChangeText={setQuery} placeholder="Search shops, words and categories" />
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
            <Text variant="body" tone="muted">{query.trim() ? "No booking matches that search." : emptyFilterText(filter)}</Text>
          ) : (
            <Empty
              title="No transactions yet"
              message="Connect a bank, or import a CSV export from your online banking, and your spending shows up here."
              actionLabel={needsSetup(connections) ? "Set up" : "Import a CSV file"}
              actionIcon={needsSetup(connections) ? "bank-plus" : "file-delimited-outline"}
              onAction={() => (needsSetup(connections) ? setSetup({ open: true }) : void importCsv())}
            />
          )
        }
        renderItem={(g) => (
          <Section title={dayHeading(g.date, today)} aside={formatMoney(dayTotal(g.items), { signed: true })}>
            <Group>
              {g.items.map((t) => (
                <TransactionRow key={t.id} item={t} split={splitIds.has(t.id)} onPress={() => setSelected(t)} />
              ))}
            </Group>
          </Section>
        )}
      />
    </Page>
  );
}
