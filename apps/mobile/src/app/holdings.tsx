import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { AsyncBoundary, Badge, Box, Button, Card, EmptyState, FadeIn, GoldCard, InvoiceCard, PaymentProofRow, Text, TextField } from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { gold, addGold, invoicePayments, addInvoicePayment, approveInvoicePayment, paymentMethods } from "../db/upstreamFeatures";
import { invoices, saveInvoice } from "../db/appFeatures";


export default function AssetsScreen() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const guard = async (fn: () => Promise<void>) => {
    setLoading(true);
    try { await fn(); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load this screen"); }
    finally { setLoading(false); }
  };
  const [goldRows, setGoldRows] = useState<{ id: number; name: string; grams: number; buyCentsPerGram: number; currentCentsPerGram: number }[]>([]);
  const [invoiceRows, setInvoiceRows] = useState<{ id: number; number: string; customer: string; totalCents: number; status: string }[]>([]);
  const [payments, setPayments] = useState<{ id: number; invoiceId: number; cents: number; status: string }[]>([]);
  const [methods, setMethods] = useState<{ id: number; name: string }[]>([]);
  const [name, setName] = useState("");
  const [grams, setGrams] = useState("5");
  const [buy, setBuy] = useState("5000");
  const [current, setCurrent] = useState("6000");
  const [customer, setCustomer] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");

  const load = async () => {
    const [g, i, p, m] = await Promise.all([gold(), invoices(), invoicePayments(), paymentMethods()]);
    setGoldRows(g as never); setInvoiceRows(i); setPayments(p); setMethods(m);
  };
  useEffect(() => { void guard(load); }, []);

  return (
    <Screen title="Assets" subtitle="Dompetku gold and invoices" back={<AppIconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}>
      <AsyncBoundary loading={loading} error={error} onRetry={() => void guard(load)} rows={4}>
      <FadeIn>
      <Card>
        <SectionTitle>Gold</SectionTitle>
        {goldRows.map((g) => { const p = core.goldProfit(g.grams, g.buyCentsPerGram, g.currentCentsPerGram); return <GoldCard key={g.id} name={g.name} grams={g.grams} costCents={p.cost} valueCents={p.value} profitCents={p.profit} />; })}
        <TextField label="Name" value={name} onChangeText={setName} />
        <Box row gap={8}>
          <TextField label="Grams" value={grams} onChangeText={setGrams} numeric />
          <TextField label="Buy/g" value={buy} onChangeText={setBuy} numeric />
          <TextField label="Now/g" value={current} onChangeText={setCurrent} numeric />
        </Box>
        <Button label="Add gold" icon="plus" onPress={() => { void addGold(name || "Gold", Number(grams) || 1, parseEuro(buy) ?? 0, parseEuro(current) ?? 0).then(() => { setName(""); void load(); }); }} />
        {!goldRows.length ? <EmptyState title="No gold yet" message="Add a holding above." icon="gold" /> : null}
      </Card>
      <Card>
        <SectionTitle>Invoices (19% VAT)</SectionTitle>
        {invoiceRows.map((i) => <InvoiceCard key={i.id} number={i.number} customer={i.customer} totalCents={i.totalCents} status={i.status as never} />)}
        <TextField label="Customer" value={customer} onChangeText={setCustomer} />
        <TextField label="Item" value={description} onChangeText={setDescription} />
        <TextField label="Unit price" value={price} onChangeText={setPrice} numeric />
        <Button label="Create invoice" icon="receipt" onPress={() => { const c = parseEuro(price); if (c !== null && customer && description) void saveInvoice(`INV-${String(invoiceRows.length + 1).padStart(3, "0")}`, customer, core.invoiceTotal([{ qty: 1, cents: c }], 19), "draft", [{ description, qty: 1, cents: c }]).then(() => { setCustomer(""); setDescription(""); setPrice(""); void load(); }); }} />
        {!invoiceRows.length ? <EmptyState title="No invoices yet" message="Create an invoice above." icon="receipt" /> : null}
      </Card>
      <Card>
        <SectionTitle>Payment proofs</SectionTitle>
        {payments.map((p) => (
          <Box key={p.id} row style={{ justifyContent: "space-between" }}>
            <PaymentProofRow method={`Invoice #${p.invoiceId}`} cents={p.cents} status={p.status} />
            {p.status !== "approved" ? <Button label="Approve" onPress={() => void approveInvoicePayment(p.id).then(() => void guard(load))} /> : null}
          </Box>
        ))}
        {methods.map((m) => <Badge key={m.id} label={m.name} />)}
        <Button label="Record payment" variant="secondary" onPress={() => { const c = parseEuro(price); if (c !== null && invoiceRows[0]) void addInvoicePayment(invoiceRows[0].id, 1, c).then(() => void guard(load)); }} />
      </Card>
      <Button label="Export reports / PDF" icon="file-pdf-box" variant="secondary" onPress={() => router.push("/reports")} />
    </FadeIn>
    </AsyncBoundary>
    </Screen>
  );
}
