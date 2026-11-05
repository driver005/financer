import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Badge, Balance, BarChart, Box, Button, Card, Chip, ChipRow, Expandable, Group, IconButton, Note, QuickActions, Row, SearchBar, Section, Text, VirtualList } from "@financer/ui";

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
import { BookingFiltersSheet, type CategoryOption } from "@/components/BookingFiltersSheet";
import { categoryLabel } from "@/categoryIcons";
import { NO_FILTERS, SORTS, TX_FILTERS, applyFilters, dayTotal, filterChips, incomeSpent, withoutFilter, type BookingFilters } from "@/spendingView";
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
  const [filters, setFilters] = useState<BookingFilters>(NO_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const shown = useMemo(() => applyFilters(items, filters, today), [items, filters, today]);
  // the order the list is in decides how it is grouped: by day, or in one run for the amount orders
  const byAmount = filters.sort === "largest" || filters.sort === "smallest";
  const groups = useMemo(() => (byAmount ? (shown.length ? [{ date: "", items: shown }] : []) : groupByDay(shown)), [shown, byAmount]);
  const totals = useMemo(() => incomeSpent(shown), [shown]);
  const chips = useMemo(() => filterChips(filters), [filters]);
  // what the filter sheet offers: every category there is, with how many bookings it has
  const categories = useMemo<CategoryOption[]>(() => {
    const counts = new Map<string, number>();
    for (const t of items) counts.set(t.category ?? "uncategorized", (counts.get(t.category ?? "uncategorized") ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: categoryLabel(key === "uncategorized" ? null : key), count }));
  }, [items]);
  // the span of what is listed, for the "Where it went" card
  const span = useMemo(() => {
    if (!shown.length) return null;
    const dates = shown.map((t) => t.booking_date).sort();
    return { start: dates[0], end: dates[dates.length - 1] };
  }, [shown]);
  const splitIds = useMemo(() => new Set(splits.map((s) => s.transaction_id)), [splits]);
  const trend = useMemo(() => spendingTrend(items, today, TREND_DAYS), [items, today]);

  if (!loaded) return <Page title="Spending"><Loading /></Page>;
  if (!api) return <Page title="Spending"><SectionSwitch /><NeedsSetup /></Page>;

  const summary = trendSummary(trend, TREND_DAYS);
  const peak = peakText(trend);
  const delta = trend.deltaPercent;
  const sentence = `${summary}${peak ? ` ${peak}.` : ""}`;

  const connected = banks.list !== null && connections.length > 0;
  const firstTime = banks.list !== null && connections.length === 0;
  const filtered = chips.length > 0;

  return (
    <Page
      title="Spending"
      subtitle={items.length > 0 ? (filtered ? `${shown.length} of ${items.length} bookings` : `${items.length} bookings`) : undefined}
      fixed
      actions={
        connected ? (
          <>
            <IconButton icon="bank-transfer" label="Sync with your bank" onPress={() => router.push("/sync")} />
            <IconButton icon="link-variant" label="Connected banks and sources" onPress={() => setSetup({ open: true })} />
            <IconButton icon="storefront-outline" label="Spending by store" onPress={() => router.push("/stores")} />
          </>
        ) : undefined
      }
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
      <BookingFiltersSheet visible={filtersOpen} onClose={() => setFiltersOpen(false)} filters={filters} onChange={setFilters} categories={categories} resultCount={shown.length} />
      <VirtualList
        data={groups}
        keyExtractor={(g) => g.date || "all"}
        refreshing={busy && fetched}
        onRefresh={load}
        gap="lg"
        header={
          <Box gap="md">
            <SectionSwitch />
            {firstTime ? (
              <>
                <QuickActions
                  actions={[
                    { icon: "file-delimited-outline", label: "Import", onPress: () => void importCsv(), disabled: busy },
                    { icon: "bank-plus", label: "Banks", onPress: () => setSetup({ open: true }) },
                    { icon: "storefront-outline", label: "Stores", onPress: () => router.push("/stores") },
                  ]}
                />
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
              </>
            ) : null}
            {items.length > 0 ? (
              <>
                <Balance
                  label={`Spent, last ${TREND_DAYS} days`}
                  cents={trend.total}
                  spoken={`Spent ${spokenMoney(trend.total)} in the last ${TREND_DAYS} days`}
                  chip={delta !== null && delta !== 0 ? <Badge tone={delta > 0 ? "warning" : "success"} icon={delta > 0 ? "trending-up" : "trending-down"} label={`${Math.abs(delta)} % ${delta > 0 ? "more" : "less"} than before`} /> : undefined}
                />
                <Expandable icon="chart-box-outline" title="Charts and where it went" summary="The last 14 days, what came in and went out, and the categories">
                  <BarChart values={trend.series} highlight={trend.peak} summary={sentence} />
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
                  {filters.kind !== "income" && span ? <CategoryCard txs={shown} period={span} link={false} bubbles /> : null}
                </Expandable>

                <SearchBar value={filters.query} onChangeText={(query) => setFilters({ ...filters, query })} placeholder="Search shops, words and categories" />
                <Row gap="sm" align="center">
                  <Box grow>
                    <ChipRow>
                      {TX_FILTERS.map((f) => (
                        <Chip key={f.value} label={f.label} selected={filters.kind === f.value} onPress={() => setFilters({ ...filters, kind: f.value })} />
                      ))}
                    </ChipRow>
                  </Box>
                  <Button label={chips.length > 0 ? `Filters · ${chips.length}` : "Filters"} icon="tune-variant" variant={chips.length > 0 ? "soft" : "outline"} size="sm" onPress={() => setFiltersOpen(true)} />
                </Row>
                {chips.length > 0 ? (
                  <ChipRow>
                    {chips.map((c) => (
                      <Chip key={c.key} label={c.label} onRemove={() => setFilters(withoutFilter(filters, c.key))} />
                    ))}
                    <Chip label="Clear all" icon="close-circle-outline" onPress={() => setFilters(NO_FILTERS)} />
                  </ChipRow>
                ) : null}
                <Row justify="between" gap="md" accessible accessibilityLabel={`${shown.length} bookings, ${spokenMoney(totals.income)} came in, ${spokenMoney(totals.spent)} spent`}>
                  <Text variant="label" tone="muted">{`${shown.length} ${shown.length === 1 ? "booking" : "bookings"}`}</Text>
                  <Text variant="label" tone="muted">{`${formatMoney(totals.income)} in · ${formatMoney(totals.spent)} out`}</Text>
                </Row>
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
            <Empty
              title="No booking fits these filters"
              message="Loosen the period or the amount, or take a category off."
              actionLabel="Clear all filters"
              actionIcon="filter-remove-outline"
              onAction={() => setFilters(NO_FILTERS)}
            />
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
          <Section title={g.date ? dayHeading(g.date, today) : (SORTS.find((o) => o.value === filters.sort)?.label ?? "")} aside={formatMoney(dayTotal(g.items), { signed: true })}>
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
