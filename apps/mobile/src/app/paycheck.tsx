import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { AsyncBoundary, Badge, Box, Button, Card, EmptyState, FadeIn, PaycheckWaterfall, Segmented, Text, TextField } from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { paychecks, allocations, savePaycheck } from "../db/appFeatures";

export default function PaycheckScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setLoading(true);
    try { await fn(); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load this screen"); }
    finally { setLoading(false); }
  };
  const [pays, setPays] = useState<{ id: number; date: string; takeHomeCents: number }[]>([]);
  const [allocs, setAllocs] = useState<{ id: number; paycheckId: number; label: string; cents: number; kind: string }[]>([]);
  const [takeHome, setTakeHome] = useState("2450");
  const [bills, setBills] = useState("35");
  const [envelopes, setEnvelopes] = useState("20");
  const [plans, setPlans] = useState("10");
  const [frequency, setFrequency] = useState("monthly");

  const load = async () => { const [p, a] = await Promise.all([paychecks(), allocations()]); setPays(p); setAllocs(a); };
  useEffect(() => { void guard(load); }, []);

  const run = async () => {
    const take = parseEuro(takeHome);
    if (take === null) return;
    const rules = [
      { label: "Fixed bills", kind: "fixed", cents: Math.round((take * Number(bills)) / 100), percent: 0 },
      { label: "Envelopes", kind: "envelope", cents: 0, percent: Number(envelopes) },
      { label: "Plans", kind: "plan", cents: 0, percent: Number(plans) },
    ];
    const plan = core.paycheckPlan(take, rules);
    await savePaycheck(new Date().toISOString().slice(0, 10), take, plan);
    await load();
  };

  const current = pays[0];
  const currentRows = current ? allocs.filter((a) => a.paycheckId === current.id) : [];

  return (
    <Screen title="Paycheck" subtitle="Jings waterfall + Dompetku allocations" back={<AppIconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}>
      <AsyncBoundary loading={loading} error={error} onRetry={() => void guard(load)} rows={4}>
      <FadeIn>
      <Card>
        <SectionTitle>New paycheck</SectionTitle>
        <TextField label="Take-home" value={takeHome} onChangeText={setTakeHome} numeric />
        <Box row gap={8}>
          <TextField label="Bills %" value={bills} onChangeText={setBills} numeric />
          <TextField label="Envelopes %" value={envelopes} onChangeText={setEnvelopes} numeric />
          <TextField label="Plans %" value={plans} onChangeText={setPlans} numeric />
        </Box>
        <Segmented value={frequency} onChange={setFrequency} options={[
          { value: "weekly", label: "Weekly" }, { value: "biweekly", label: "Biweekly" },
          { value: "semimonthly", label: "Semi" }, { value: "monthly", label: "Monthly" },
        ]} />
        <Button label="Allocate" icon="water" onPress={() => void run()} />
        <Text variant="body5" color="muted">{`Monthly equivalent of 1200: ${(core.paycheckProration(120000, frequency) / 100).toFixed(2)}`}</Text>
      </Card>
      {current ? <PaycheckWaterfall takeHomeCents={current.takeHomeCents} steps={currentRows.map((a) => ({ label: a.label, cents: a.cents, kind: a.kind as never }))} /> : null}
      <Card>
        <SectionTitle>History</SectionTitle>
        {!pays.length ? <EmptyState title="No paychecks yet" message="Set take-home pay and allocate above." icon="cash" /> : null}
        {core.paycheckHistory(pays, allocs).map((h, i) => <Badge key={i} label={`${h.date} · guilt-free ${(h.guiltFree / 100).toFixed(2)}`} />)}
      </Card>
    </FadeIn>
    </AsyncBoundary>
    </Screen>
  );
}
