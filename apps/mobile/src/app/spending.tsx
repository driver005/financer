import { useFocusEffect, useRouter } from "expo-router";
import { useCallback, useMemo, useState } from "react";
import { Box, Chip, ChipRow, Group, IconButton, ListItem, Note, Pill, PillRow, QuickActions, SearchBar, Section, Sheet, Text, VirtualList } from "@financer/ui";

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
import { dayHeading } from "@/format";
import { defaultSource, needsSetup, type SourceId } from "@/bankSetup";
import { pickFileBytes } from "@/native/files";
import { localIsoDate } from "@/period";
import { useBankSources } from "@/useBankSources";
import { BookingFiltersSheet, type CategoryOption } from "@/components/BookingFiltersSheet";
import { categoryLabel } from "@/categoryIcons";
import { NO_FILTERS, SORTS, TX_FILTERS, applyFilters, filterChips, withoutFilter, type BookingFilters } from "@/spendingView";

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
  const [searching, setSearching] = useState(false);
  const [more, setMore] = useState(false);
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
  const chips = useMemo(() => filterChips(filters), [filters]);
  // what the filter sheet offers: every category there is, with how many bookings it has
  const categories = useMemo<CategoryOption[]>(() => {
    const counts = new Map<string, number>();
    for (const t of items) counts.set(t.category ?? "uncategorized", (counts.get(t.category ?? "uncategorized") ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, label: categoryLabel(key === "uncategorized" ? null : key), count }));
  }, [items]);
  const splitIds = useMemo(() => new Set(splits.map((s) => s.transaction_id)), [splits]);

  if (!loaded) return <Page title="Spending"><Loading /></Page>;
  if (!api) return <Page title="Spending"><SectionSwitch /><NeedsSetup /></Page>;

  const connected = banks.list !== null && connections.length > 0;
  const firstTime = banks.list !== null && connections.length === 0;
  // what is on besides the Income / Expenses pills: those two stay in the pills, the rest are chips
  const extra = chips.filter((c) => c.key !== "kind");

  return (
    <Page
      title=""
      fixed
      actions={
        <>
          <IconButton icon="magnify" label="Search bookings" onPress={() => setSearching(!searching)} selected={searching || filters.query.trim() !== ""} />
          <IconButton icon="calendar-month-outline" label="Filter bookings by period, category and amount" onPress={() => setFiltersOpen(true)} selected={extra.some((c) => c.key !== "query")} />
          <IconButton icon="dots-horizontal" label="More: sync, banks, stores and import" onPress={() => setMore(true)} />
        </>
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
      <Sheet visible={more} onClose={() => setMore(false)} title="More">
        <Box px="xl" pb="xl">
          <ListItem icon="file-delimited-outline" tile title="Import a CSV file" subtitle="The export of your online banking" onPress={() => { setMore(false); void importCsv(); }} />
          {connected ? <ListItem icon="bank-transfer" tile title="Sync with your bank" onPress={() => { setMore(false); router.push("/sync"); }} /> : null}
          <ListItem icon="link-variant" tile title={connected ? "Connected banks and sources" : "Connect a bank"} onPress={() => { setMore(false); setSetup({ open: true }); }} />
          <ListItem icon="storefront-outline" tile title="Spending by store" onPress={() => { setMore(false); router.push("/stores"); }} />
        </Box>
      </Sheet>
      <VirtualList
        data={groups}
        keyExtractor={(g) => g.date || "all"}
        refreshing={busy && fetched}
        onRefresh={load}
        gap="xl"
        header={
          <Box gap="lg">
            <SectionSwitch />
            <Box gap="sm">
              <Text variant="display" level={1} tone="on-success-soft">Transactions</Text>
              <Text variant="subheading" tone="muted">Track your spending and stay in control of your money.</Text>
            </Box>
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
                {searching ? <SearchBar value={filters.query} onChangeText={(query) => setFilters({ ...filters, query })} placeholder="Search shops, words and categories" /> : null}
                <PillRow>
                  {TX_FILTERS.map((f) => (
                    <Pill key={f.value} label={f.label} selected={filters.kind === f.value} onPress={() => setFilters({ ...filters, kind: f.value })} />
                  ))}
                </PillRow>
                {extra.length > 0 ? (
                  <ChipRow>
                    {extra.map((c) => (
                      <Chip key={c.key} label={c.label} tone="success" onRemove={() => setFilters(withoutFilter(filters, c.key))} />
                    ))}
                    <Chip label="Clear all" icon="close-circle-outline" onPress={() => setFilters(NO_FILTERS)} />
                  </ChipRow>
                ) : null}
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
          <Box gap="sm">
            <Text variant="bodyStrong" level={2} tone="on-success-soft">{g.date ? dayHeading(g.date, today) : (SORTS.find((o) => o.value === filters.sort)?.label ?? "")}</Text>
            <Group inset>
              {g.items.map((t) => (
                <TransactionRow key={t.id} item={t} split={splitIds.has(t.id)} onPress={() => setSelected(t)} />
              ))}
            </Group>
          </Box>
        )}
      />
    </Page>
  );
}
