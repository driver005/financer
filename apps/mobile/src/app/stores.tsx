import { useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Badge, Box, Card, Divider, HeroCaption, HeroCard, HeroChip, HeroFigure, Icon, Meter, Row, Segmented, Text, Touchable, type Tone } from "@financer/ui";

import type { Split, StoreSpend, StoreSpending, Transaction } from "@/api/client";
import { useApi } from "@/api/config";
import { RecategorizeSheet } from "@/components/RecategorizeSheet";
import { TransactionRow } from "@/components/TransactionRow";
import { Page } from "@/components/Page";
import { Loading, NeedsSetup } from "@/components/Status";
import { toTone, type LegacyTone } from "@/uiTone";
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

const SERIES: Tone[] = ["accent", "info", "success", "warning", "danger"];

type Visits = { loading: boolean; items: Transaction[]; error?: string };

/** What I spend at each supermarket: ranked chains for a budget period, tap one for its visits. */
export default function Stores() {
  const { api, loaded } = useApi();
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

  if (!loaded) return <Page title="Stores"><Loading /></Page>;
  if (!api) return <Page title="Stores"><NeedsSetup /></Page>;

  const rows = data ? rankedRows(data) : [];
  const tone: Record<ChangeTone, LegacyTone> = { up: "bad", down: "good", flat: "muted", new: "warn" };
  const hint = data ? unmatchedHint(data) : null;

  return (
    <Page title="Stores">
      <Segmented value={view} onChange={choose} options={STORES_VIEWS.map((v) => ({ value: v.value, label: v.label }))} />

      {error ? <Text variant="body" tone="muted">{error}</Text> : null}
      {!data && !error ? <Loading /> : null}
      {note ? <Text variant="label" tone="muted">{note}</Text> : null}

      {data ? (
        <>
          <HeroCard label="Spent in stores" chip={<HeroChip text={periodLabel({ start: data.start, end: data.end })} />}>
            <HeroFigure cents={data.total_cents} label={`Spent in stores: ${formatCents(data.total_cents)}`} />
            <HeroCaption>{totalText(data)}</HeroCaption>
            {data.previous_total_cents > 0 || data.total_cents > 0 ? <HeroCaption>{`Compared with ${compareText(data)}`}</HeroCaption> : null}
          </HeroCard>

          {rows.length === 0 ? (
            <Card>
              <Text variant="body" tone="muted">
                No store spending in this period yet. Import or sync your bank transactions on the Spending tab; chains such as Lidl, Aldi, Rewe or Kaufland are recognized from the booking text.
              </Text>
            </Card>
          ) : null}

          {rows.map((row, index) => {
            const isOpen = open === row.chain;
            const v = visits[row.chain];
            const last = lastVisitText(row.last_visit, today);
            return (
              <Card key={row.chain} gap="md">
                <Touchable onPress={() => toggle(row)} label={`${rowLabel(row)}. ${isOpen ? "Hide" : "Show"} the visits`} selected={isOpen} gap="sm">
                  <Row justify="between" gap="sm">
                    <Box grow><Text variant="subheading" numberOfLines={1}>{row.name}</Text></Box>
                    <Text variant="subheading">{formatCents(row.total_cents)}</Text>
                    <Icon name={isOpen ? "chevron-up" : "chevron-down"} size="md" tone="muted" />
                  </Row>
                  <Meter value={barFraction(row, rows)} tone={SERIES[index % SERIES.length]} thickness="lg" />
                  <Row gap="sm" wrap>
                    <Text variant="label">{formatPermille(row.share_permille)}</Text>
                    <Text variant="label" tone="muted">{`${visitsText(row.visits)}${row.visits > 0 ? ` · ⌀ ${formatCents(row.average_basket_cents)}` : ""}${last ? ` · ${last}` : ""}`}</Text>
                    <Badge label={changeText(row)} tone={toTone(tone[changeTone(row)])} />
                  </Row>
                </Touchable>

                {isOpen ? (
                  <Box gap="xs">
                    <Divider />
                    {v?.loading && v.items.length === 0 ? <Loading /> : null}
                    {v?.error ? <Text variant="body" tone="muted">{v.error}</Text> : null}
                    {v && !v.loading && !v.error && v.items.length === 0 ? <Text variant="body" tone="muted">No bookings in this range.</Text> : null}
                    {v?.items.map((t) => (
                      <TransactionRow key={t.id} item={t} split={splits.some((s) => s.transaction_id === t.id)} onPress={() => setSelected(t)} />
                    ))}
                  </Box>
                ) : null}
              </Card>
            );
          })}

          {hint ? <Text variant="caption" tone="muted">{hint}</Text> : null}
          <Text variant="caption" tone="muted">Counts expenses only, one visit per booking. Refunds are not subtracted.</Text>
        </>
      ) : null}

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
    </Page>
  );
}
