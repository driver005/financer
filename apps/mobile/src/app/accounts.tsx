import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { Badge, Box, Button, Card, Money, StatCard, Text, TextField, ValuationRow, WalletSwitcher } from "@finance/ui";
import { Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { accounts, transfer } from "../db/moneyTracker";
import { valuations, addValuation } from "../db/appFeatures";
import { setAccountFees } from "../db/upstreamFeatures";

type Account = { id: string; name: string; balanceCents: number; kind: string; currency: string; feesCents: number };
type Valuation = { id: number; accountId: string; date: string; valueCents: number };

export default function AccountsScreen() {
  const router = useRouter();
  const [rows, setRows] = useState<Account[]>([]);
  const [vals, setVals] = useState<Valuation[]>([]);
  const [active, setActive] = useState("");
  const [amount, setAmount] = useState("");
  const [fee, setFee] = useState("");

  const load = async () => { const [a, v] = await Promise.all([accounts(), valuations()]); setRows(a as never); setVals(v); setActive((prev) => prev || a[0]?.id || ""); };
  useEffect(() => { void load(); }, []);

  return (
    <Screen title="Accounts" subtitle="Pockaw wallets + Boring Balance valuations" back={<Button label="Back" variant="secondary" onPress={() => router.back()} />}>
      <Card>
        <SectionTitle>Wallets</SectionTitle>
        <WalletSwitcher wallets={rows.map((r) => ({ id: r.id, name: r.name, currency: r.currency }))} active={active} onChange={setActive} />
        {rows.map((r) => (
          <Box key={r.id} row style={{ justifyContent: "space-between" }}>
            <Text variant="body3">{`${r.name} · ${r.kind}`}</Text>
            <Money cents={r.balanceCents} variant="numericMedium" />
            <Badge label={`fee ${(r.feesCents / 100).toFixed(2)}`} />
          </Box>
        ))}
        <TextField label="Monthly fee" value={fee} onChangeText={setFee} numeric />
        <Button label="Save fee" variant="secondary" onPress={() => { const c = parseEuro(fee); if (c !== null && active) void setAccountFees(active, c).then(load); }} />
      </Card>
      <Card>
        <SectionTitle>Transfer</SectionTitle>
        <TextField label="Amount" value={amount} onChangeText={setAmount} numeric />
        <Button label="Transfer to second account" icon="swap-horizontal" onPress={() => { const c = parseEuro(amount); if (c !== null && rows.length > 1) void transfer(rows[0].id, rows[1].id, c).then(load); }} />
      </Card>
      <Card>
        <SectionTitle>Valuations</SectionTitle>
        {vals.map((v) => <ValuationRow key={v.id} label={`${rows.find((r) => r.id === v.accountId)?.name ?? v.accountId} · ${v.date}`} valueCents={v.valueCents} changeCents={core.valuationChange(vals, v.accountId)} />)}
        <Button label="Add valuation" icon="plus" onPress={() => void addValuation(active, new Date().toISOString().slice(0, 10), 100000).then(load)} />
      </Card>
      <StatCard label="Net worth" cents={rows.reduce((a, r) => a + r.balanceCents, 0)} />
    </Screen>
  );
}
