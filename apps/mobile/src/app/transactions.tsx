import React, { useEffect, useMemo, useState } from "react";
import { useRouter } from "expo-router";
import { AsyncBoundary, Box, Button, Card, FadeIn, FgCashbackPill, FgDateHeader, FgHeaderIcon, FgScreen, Text } from "@finance/ui";
import { fgEuro } from "@finance/ui";
import { core } from "../rust/core";
import { allTransactions, accounts, recurringList } from "../db/moneyTracker";

type Row = { id: number; date: string; merchant: string; amountCents: number; category: string; kind?: string };

const EMOJI: Record<string, string> = {
  "Internet & Phone": "📱", Streaming: "🎬", "TV & Streaming": "🎬", Shopping: "🛍️",
  "Bus & Train": "🚆", Insurance: "🛡️", Supermarket: "🛒", Rent: "🏠", Contract: "📄",
  "Food & Drinks": "🥤", Leisure: "😊", Transport: "🚗", Salary: "💼",
};
const pillFor = (row: Row) =>
  row.category === "Contract" || row.category === "TV & Streaming" ? "Contract" : null;

function dateLabel(date: string) {
  const today = new Date();
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return date;
  const diff = Math.round((d.setHours(0, 0, 0, 0) - new Date(today).setHours(0, 0, 0, 0)) / 86400000);
  if (diff === 0) return "Today";
  if (diff === -1) return "Yesterday";
  if (diff === 1) return "Tomorrow";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function TransactionsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Row[]>([]);
  const [balanceCents, setBalanceCents] = useState(0);
  const [forecastCents, setForecastCents] = useState(0);
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    void Promise.all([allTransactions(), accounts(), recurringList()])
      .then(([tx, accts, rec]) => {
        setRows(tx as unknown as Row[]);
        const balance = accts.reduce((sum, a) => sum + a.balanceCents, 0);
        setBalanceCents(balance);
        const upcoming = (core.scheduled(rec) as { amountCents: number }[]).reduce((sum, r) => sum + r.amountCents, 0);
        setForecastCents(balance + upcoming);
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load transactions"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const stores = useMemo(() => core.supermarkets(), []);
  const groups = useMemo(() => {
    const visible = rows.filter((r) => r.merchant.toLowerCase().includes(filter.toLowerCase()) || r.category.toLowerCase().includes(filter.toLowerCase()));
    const map = new Map<string, Row[]>();
    for (const row of visible) {
      const key = row.date.slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows, filter]);

  return (
    <FgScreen
      title="All Transactions"
      actions={
        <>
          <FgHeaderIcon name="view-grid" label="All apps" onPress={() => router.push("/hub")} />
          <FgHeaderIcon name="send-outline" label="Transfer" onPress={() => router.push("/accounts")} />
          <FgHeaderIcon name="magnify" label="Search" onPress={() => router.push("/pc")} />
          <FgHeaderIcon name="dots-horizontal" label="More" onPress={() => router.push("/flows")} />
        </>
      }
    >
      <AsyncBoundary loading={loading} error={error} onRetry={load} rows={6}>
        <FadeIn>
          <Card>
            <Box row style={{ justifyContent: "space-between" }}>
              <Text variant="caption" color="muted">Tomorrow</Text>
              <Text variant="numericTitle" color="income">{fgEuro(forecastCents)}</Text>
              <Text variant="caption" color="muted">Today · {fgEuro(balanceCents)}</Text>
            </Box>
          </Card>
        </FadeIn>
        <FadeIn delay={60}>
          <Card>
            <Box row gap={8}>
              <Text variant="body4" color="muted">{`${rows.length} bookings`}</Text>
            </Box>
            {groups.map(([date, items], index) => (
              <Box key={date} gap={4}>
                <FgDateHeader label={dateLabel(date)} right={index === 0 ? fgEuro(items.reduce((s, r) => s + r.amountCents, 0)) : undefined} highlight={dateLabel(date) === "Today"} />
                {items.map((row) => {
                  const pill = pillFor(row);
                  const missed = core.matchStore(row.merchant, stores) !== null;
                  return (
                    <Box key={row.id} row gap={12} style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: "#E4E2ED" }}>
                      <Box style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: "#F2F1F6", alignItems: "center", justifyContent: "center" }}>
                        <Text variant="body2">{EMOJI[row.category] ?? "🏷️"}</Text>
                      </Box>
                      <Box style={{ flex: 1, gap: 3 }}>
                        <Text variant="body2">{row.merchant}</Text>
                        <Box row gap={6} style={{ alignItems: "center" }}>
                          <Text variant="caption" color="muted">{row.category}</Text>
                          {pill ? <Box style={{ backgroundColor: "#ECEAF3", borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}><Text variant="body5" color="muted">{pill}</Text></Box> : null}
                        </Box>
                        {missed ? <FgCashbackPill onPress={() => router.push("/savings")} /> : null}
                      </Box>
                      <Text variant="numericMedium" style={{ color: row.kind === "income" ? "#0E7A55" : "#2A2166" }}>
                        {fgEuro(row.kind === "income" ? row.amountCents : -Math.abs(row.amountCents))}
                      </Text>
                    </Box>
                  );
                })}
              </Box>
            ))}
            {!groups.length ? <Text variant="body3" color="muted">No transactions match your search.</Text> : null}
          </Card>
        </FadeIn>
        <FadeIn delay={120}>
          <Box row gap={8}>
            <Button label="Add transaction" icon="plus" onPress={() => router.push("/quickadd")} />
            <Button label="Full editor" variant="secondary" onPress={() => router.push("/pc")} />
          </Box>
        </FadeIn>
      </AsyncBoundary>
    </FgScreen>
  );
}
