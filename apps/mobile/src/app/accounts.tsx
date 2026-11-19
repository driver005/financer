import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { AsyncBoundary, Badge, Box, Button, Card, EmptyState, FadeIn, Money, StatCard, Text, TextField, ValuationRow, WalletSwitcher } from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { accounts, transfer } from "../db/moneyTracker";
import { valuations, addValuation } from "../db/appFeatures";
import { setAccountFees } from "../db/upstreamFeatures";

type Account = { id: string; name: string; balanceCents: number; kind: string; currency: string; feesCents: number };
type Valuation = { id: number; accountId: string; date: string; valueCents: number };

export default function AccountsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setLoading(true);
    try { await fn(); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load this screen"); }
    finally { setLoading(false); }
  };
  const [rows, setRows] = useState<Account[]>([]);
  const [vals, setVals] = useState<Valuation[]>([]);
  const [active, setActive] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");

  const load = async () => { const [a, v] = await Promise.all([accounts(), valuations()]); setRows(a as never); setVals(v); setActive((prev) => prev || a[0]?.id || ""); };
  useEffect(() => { void guard(load); }, []);

  return (
    <Screen title="Accounts" subtitle="Pockaw wallets + Boring Balance valuations" back={<AppIconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}>
      <AsyncBoundary loading={loading} error={error} onRetry={() => void guard(load)} rows={4}>
      <FadeIn>
      <Card>
        <SectionTitle>Wallets</SectionTitle>
        <WalletSwitcher wallets={rows.map((r) => ({ id: r.id, name: r.name, currency: r.currency }))} active={active} onChange={setActive} />
        {!rows.length ? <EmptyState title="No accounts" message="Add an account in Settings or Money tools." icon="wallet-outline" /> : null}
        {rows.map((r) => (
          <Box key={r.id} row style={{ justifyContent: "space-between" }}>
            <Text variant="body3">{`${r.name} · ${r.kind}`}</Text>
            <Money cents={r.balanceCents} variant="numericMedium" />
            <Badge label={`fee ${(r.feesCents / 100).toFixed(2)}`} />
          </Box>
        ))}
        <TextField label="Monthly fee" value={fee} onChangeText={setFee} numeric />
        <Button label="Save fee" variant="secondary" onPress={() => { const c = parseEuro(fee); if (c !== null && active) void setAccountFees(active, c).then(() => void guard(load)); }} />
      </Card>
      <Card>
        <SectionTitle>Transfer</SectionTitle>
        <TextField label="Amount" value={amount} onChangeText={setAmount} numeric />
        <Button label="Transfer to second account" icon="swap-horizontal" onPress={() => { const c = parseEuro(amount); if (c !== null && rows.length > 1) void transfer(rows[0].id, rows[1].id, c).then(() => void guard(load)); }} />
      </Card>
      <Card>
        <SectionTitle>Valuations</SectionTitle>
        {!vals.length ? <EmptyState title="No valuations" message="Record a valuation to see net worth trend." icon="chart-line" /> : null}
        {vals.map((v) => <ValuationRow key={v.id} label={`${rows.find((r) => r.id === v.accountId)?.name ?? v.accountId} · ${v.date}`} valueCents={v.valueCents} changeCents={core.valuationChange(vals, v.accountId)} />)}
        <Button label="Add valuation" icon="plus" onPress={() => void addValuation(active, new Date().toISOString().slice(0, 10), 100000).then(() => void guard(load))} />
      </Card>
      <StatCard label="Net worth" cents={rows.reduce((a, r) => a + r.balanceCents, 0)} />
    </FadeIn>
    </AsyncBoundary>
    </Screen>
  );
}
