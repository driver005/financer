import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, useColorScheme, View } from "react-native";
import { useRouter } from "expo-router";
import {
  Badge, Box, BudgetCard, Button, Card, EnvelopeList, FinanceUIProvider, GoalCard,
  InvoiceCard, Money, ObligationRow, PaycheckWaterfall, PlanCard, Progress, RecurringRow,
  SplitEditor, Text, TextField, ValuationRow, darkTheme, lightTheme,
} from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { accounts, budgets, goals, receipts, recurringList, setBudget } from "../db/moneyTracker";
import {
  envelopes, addEnvelope, fundEnvelope, checklist, addChecklistItem, toggleChecklistItem,
  paychecks, allocations, savePaycheck, invoices, saveInvoice, valuations, addValuation, splits, saveSplits,
} from "../db/appFeatures";
import { allTransactions } from "../db/moneyTracker";

export default function FinanceScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const theme = scheme === "dark" ? darkTheme : lightTheme;
  const [accountList, setAccountList] = useState<{ id: string; name: string }[]>([]);
  const [budgetList, setBudgetList] = useState<{ id: number; category: string; limitCents: number; rolloverCents: number }[]>([]);
  const [goalList, setGoalList] = useState<{ id: number; title: string; targetCents: number; savedCents: number }[]>([]);
  const [checklistRows, setChecklistRows] = useState<{ id: number; goalId: number; title: string; amountCents: number; completed: number }[]>([]);
  const [envelopeRows, setEnvelopeRows] = useState<{ id: number; name: string; balanceCents: number; limitCents: number; rollover: number }[]>([]);
  const [paycheckRows, setPaycheckRows] = useState<{ id: number; date: string; takeHomeCents: number }[]>([]);
  const [allocationRows, setAllocationRows] = useState<{ id: number; paycheckId: number; label: string; cents: number; kind: string }[]>([]);
  const [recurringRows, setRecurringRows] = useState<{ id: number; name: string; amountCents: number; dayOfMonth: number; active: number }[]>([]);
  const [valuationRows, setValuationRows] = useState<{ id: number; accountId: string; date: string; valueCents: number }[]>([]);
  const [invoiceRows, setInvoiceRows] = useState<{ id: number; number: string; customer: string; totalCents: number; status: string }[]>([]);
  const [receiptRows, setReceiptRows] = useState<{ id: number; merchant: string; amountCents: number }[]>([]);
  const [splitRows, setSplitRows] = useState<{ id: number; person: string; sharePercent: number }[]>([]);
  const [txRows, setTxRows] = useState<Record<string, unknown>[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [takeHome, setTakeHome] = useState("2450");
  const [billsPercent, setBillsPercent] = useState("35");
  const [envelopePercent, setEnvelopePercent] = useState("20");
  const [planPercent, setPlanPercent] = useState("10");
  const [envelopeName, setEnvelopeName] = useState("");
  const [envelopeLimit, setEnvelopeLimit] = useState("250");
  const [goalId, setGoalId] = useState<number | null>(null);
  const [itemTitle, setItemTitle] = useState("");
  const [itemAmount, setItemAmount] = useState("");
  const [rolloverCategory, setRolloverCategory] = useState("Groceries");
  const [rolloverAmount, setRolloverAmount] = useState("");
  const [valuationAccount, setValuationAccount] = useState("");
  const [valuationValue, setValuationValue] = useState("");
  const [invoiceCustomer, setInvoiceCustomer] = useState("");
  const [invoiceDescription, setInvoiceDescription] = useState("");
  const [invoiceQty, setInvoiceQty] = useState("1");
  const [invoicePrice, setInvoicePrice] = useState("");
  const [splitReceiptId, setSplitReceiptId] = useState<number | null>(null);
  const [splitPeople, setSplitPeople] = useState("");

  const load = useCallback(async () => {
    const [a, b, g, c, e, p, al, r, v, i, rc, tx] = await Promise.all([
      accounts(), budgets(), goals(), checklist(), envelopes(), paychecks(), allocations(),
      recurringList(), valuations(), invoices(), receipts(), allTransactions(),
    ]);
    setAccountList(a); setBudgetList(b); setGoalList(g.map((item) => ({ ...item, title: item.name }))); setChecklistRows(c);
    setEnvelopeRows(e); setPaycheckRows(p); setAllocationRows(al); setRecurringRows(r);
    setValuationRows(v); setInvoiceRows(i); setReceiptRows(rc); setTxRows(tx);
    setGoalId((prev) => prev ?? g[0]?.id ?? null);
    setValuationAccount((prev) => prev || a[0]?.id || "");
    setSplitReceiptId((prev) => prev ?? rc[0]?.id ?? null);
    if (splitReceiptId) setSplitRows(await splits(splitReceiptId));
  }, [splitReceiptId]);

  useEffect(() => { void load(); }, [load]);

  const currentPaycheck = paycheckRows[0];
  const currentAllocations = currentPaycheck ? allocationRows.filter((a) => a.paycheckId === currentPaycheck.id) : [];
  const spending = core.categoryTotals(txRows, core.monthKey(new Date()));
  const rolled = core.rolloverStatus(budgetList, spending);
  const checkStatus = core.checklistStatus(goalList, checklistRows);
  const comparison = core.compareMonths(txRows, core.monthKey(new Date()), core.shiftPeriod("month", core.monthKey(new Date()), -1));

  const runPaycheck = async () => {
    const take = parseEuro(takeHome);
    if (take === null) { setMessage("Enter take-home pay."); return; }
    const rules = [
      { label: "Fixed bills", kind: "fixed", percent: 0, cents: Math.round(take * Number(billsPercent) / 100) },
      { label: "Envelopes", kind: "envelope", percent: Number(envelopePercent), cents: 0 },
      { label: "Plans", kind: "plan", percent: Number(planPercent), cents: 0 },
    ];
    const plan = core.paycheckPlan(take, rules);
    await savePaycheck(new Date().toISOString().slice(0, 10), take, plan);
    setMessage(`Saved ${plan.length} allocations (${Math.round((plan[plan.length - 1].cents / take) * 100)}% guilt-free).`);
    await load();
  };

  const createEnvelope = async () => {
    const limit = parseEuro(envelopeLimit);
    if (limit === null || !envelopeName) return;
    await addEnvelope(envelopeName, limit, true);
    setEnvelopeName(""); await load();
  };

  const addItem = async () => {
    const cents = parseEuro(itemAmount);
    if (cents === null || !itemTitle || goalId === null) return;
    await addChecklistItem(goalId, itemTitle, cents, "");
    setItemTitle(""); setItemAmount(""); await load();
  };

  const applyRollover = async () => {
    const cents = parseEuro(rolloverAmount);
    if (cents === null) return;
    await setBudget(rolloverCategory, budgetList.find((b) => b.category === rolloverCategory)?.limitCents ?? 0, cents);
    setRolloverAmount(""); await load();
  };

  const createValuation = async () => {
    const cents = parseEuro(valuationValue);
    if (cents === null || !valuationAccount) return;
    await addValuation(valuationAccount, new Date().toISOString().slice(0, 10), cents);
    setValuationValue(""); await load();
  };

  const createInvoice = async () => {
    const price = parseEuro(invoicePrice);
    if (price === null || !invoiceCustomer || !invoiceDescription) return;
    const items = [{ description: invoiceDescription, qty: Number(invoiceQty) || 1, cents: price }];
    const total = core.invoiceTotal(items, 19);
    await saveInvoice(`INV-${String(invoiceRows.length + 1).padStart(3, "0")}`, invoiceCustomer, total, "draft", items);
    setInvoiceCustomer(""); setInvoiceDescription(""); setInvoicePrice(""); await load();
  };

  const applySplit = async () => {
    if (!splitReceiptId) return;
    const people = splitPeople.split(/[,;]+/).map((name) => name.trim()).filter(Boolean)
      .map((person, index, all) => ({ person, sharePercent: Math.round(100 / all.length) }));
    if (!people.length) return;
    await saveSplits(splitReceiptId, people);
    setSplitRows(await splits(splitReceiptId));
    setMessage(`Split saved for ${people.length} people.`);
  };

  return (
    <FinanceUIProvider theme={theme}>
      <Screen
        title="Finance suite"
        subtitle="Pockaw base · Dompetku · Boring Balance · Jings"
        back={<AppIconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
      >
        {message ? <Badge label={message} tone="primary" /> : null}
        <Button label="More upstream features" icon="view-grid" variant="secondary" onPress={() => router.push("/upstream")} />

        <Card>
          <SectionTitle>Paycheck waterfall</SectionTitle>
          <TextField label="Take-home pay" value={takeHome} onChangeText={setTakeHome} numeric />
          <Box row gap={8}>
            <TextField label="Bills %" value={billsPercent} onChangeText={setBillsPercent} numeric />
            <TextField label="Envelopes %" value={envelopePercent} onChangeText={setEnvelopePercent} numeric />
            <TextField label="Plans %" value={planPercent} onChangeText={setPlanPercent} numeric />
          </Box>
          <Button label="Allocate paycheck" icon="water" onPress={() => void runPaycheck()} />
          {currentPaycheck ? <PaycheckWaterfall takeHomeCents={currentPaycheck.takeHomeCents} steps={currentAllocations.map((a) => ({ label: a.label, cents: a.cents, kind: a.kind as "fixed" | "envelope" | "plan" | "invest" | "leftover" }))} /> : null}
          {paycheckRows.map((p) => <Badge key={p.id} label={`${p.date} · ${(p.takeHomeCents / 100).toFixed(2)}`} />)}
        </Card>

        <Card>
          <SectionTitle>Envelopes / pockets</SectionTitle>
          <EnvelopeList envelopes={envelopeRows.map((e) => ({ id: String(e.id), name: e.name, balanceCents: e.balanceCents, limitCents: e.limitCents, rollover: !!e.rollover }))} />
          <TextField label="New envelope" value={envelopeName} onChangeText={setEnvelopeName} />
          <TextField label="Limit" value={envelopeLimit} onChangeText={setEnvelopeLimit} numeric />
          <Button label="Add envelope" icon="plus" onPress={() => void createEnvelope()} />
          <Box row gap={8}>
            {envelopeRows.map((e) => <Button key={e.id} label={`+10 ${e.name}`} variant="secondary" onPress={() => void fundEnvelope(e.id, 1000).then(load)} />)}
          </Box>
        </Card>

        <Card>
          <SectionTitle>Goals with checklist</SectionTitle>
          <Box row gap={8}>
            {goalList.map((g) => <Badge key={g.id} label={g.title} tone={goalId === g.id ? "primary" : "muted"} />)}
          </Box>
          <Box row gap={8}>
            {goalList.map((g) => <Button key={`select-${g.id}`} label={g.title} variant={goalId === g.id ? "filled" : "secondary"} onPress={() => setGoalId(g.id)} />)}
          </Box>
          <TextField label="Checklist item" value={itemTitle} onChangeText={setItemTitle} />
          <TextField label="Amount" value={itemAmount} onChangeText={setItemAmount} numeric />
          <Button label="Add item" icon="plus" onPress={() => void addItem()} />
          {goalList.filter((g) => g.id === goalId).map((g) => (
            <GoalCard
              key={g.id}
              goal={{
                id: String(g.id), title: g.title, targetCents: g.targetCents, savedCents: g.savedCents,
                items: checklistRows.filter((i) => i.goalId === g.id).map((i) => ({
                  id: String(i.id), title: i.title, amountCents: i.amountCents, completed: !!i.completed,
                })),
              }}
              onToggleItem={(id) => void toggleChecklistItem(Number(id), !checklistRows.find((i) => String(i.id) === id)?.completed).then(load)}
            />
          ))}
          {checkStatus.map((s) => <Text key={s.id} variant="body4">{`${s.name}: ${s.done}/${s.total} items · ${(s.paid / 100).toFixed(2)} done`}</Text>)}
        </Card>

        <Card>
          <SectionTitle>Rollover budgets</SectionTitle>
          {rolled.map((r) => <BudgetCard key={r.category} category={r.category} spentCents={r.spent} limitCents={r.limit} rolloverCents={r.rollover} />)}
          <TextField label="Category" value={rolloverCategory} onChangeText={setRolloverCategory} />
          <TextField label="Rollover" value={rolloverAmount} onChangeText={setRolloverAmount} numeric />
          <Button label="Save rollover" icon="plus" onPress={() => void applyRollover()} />
        </Card>

        <Card>
          <SectionTitle>Recurring events</SectionTitle>
          {recurringRows.map((r) => <RecurringRow key={r.id} name={r.name} nextDate={`day ${r.dayOfMonth}`} cents={r.amountCents} paused={!r.active} />)}
        </Card>

        <Card>
          <SectionTitle>Account valuations</SectionTitle>
          {valuationRows.map((v) => (
            <ValuationRow key={v.id} label={`${accountList.find((a) => a.id === v.accountId)?.name ?? v.accountId} · ${v.date}`} valueCents={v.valueCents} changeCents={core.valuationChange(valuationRows, v.accountId)} />
          ))}
          <TextField label="Account" value={valuationAccount} onChangeText={setValuationAccount} />
          <TextField label="Value" value={valuationValue} onChangeText={setValuationValue} numeric />
          <Button label="Add valuation" icon="plus" onPress={() => void createValuation()} />
        </Card>

        <Card>
          <SectionTitle>Compare months</SectionTitle>
          {comparison.categories.map((c) => <Box key={c.category} row style={{ justifyContent: "space-between" }}><Text variant="body3">{c.category}</Text><Money cents={c.current} variant="numericMedium" /><Badge label={`${c.changePercent.toFixed(1)}%`} tone={c.changePercent > 0 ? "expense" : "income"} /></Box>)}
        </Card>

        <Card>
          <SectionTitle>Invoices (VAT 19%)</SectionTitle>
          {invoiceRows.map((i) => <InvoiceCard key={i.id} number={i.number} customer={i.customer} totalCents={i.totalCents} status={i.status as "draft" | "sent" | "paid"} />)}
          <TextField label="Customer" value={invoiceCustomer} onChangeText={setInvoiceCustomer} />
          <TextField label="Item" value={invoiceDescription} onChangeText={setInvoiceDescription} />
          <Box row gap={8}>
            <TextField label="Qty" value={invoiceQty} onChangeText={setInvoiceQty} numeric />
            <TextField label="Unit price" value={invoicePrice} onChangeText={setInvoicePrice} numeric />
          </Box>
          <Button label="Create invoice" icon="receipt" onPress={() => void createInvoice()} />
        </Card>

        <Card>
          <SectionTitle>Split receipts</SectionTitle>
          <Box row gap={8}>
            {receiptRows.map((r) => <Badge key={r.id} label={`#${r.id} ${r.merchant}`} tone={splitReceiptId === r.id ? "primary" : "muted"} />)}
          </Box>
          <Box row gap={8}>
            {receiptRows.map((r) => <Button key={`pick-${r.id}`} label={`Pick #${r.id}`} variant="secondary" onPress={() => setSplitReceiptId(r.id)} />)}
          </Box>
          <TextField label="People (comma separated)" value={splitPeople} onChangeText={setSplitPeople} />
          <Button label="Save split" icon="account-group" onPress={() => void applySplit()} />
          {splitReceiptId ? (
            <SplitEditor
              totalCents={receiptRows.find((r) => r.id === splitReceiptId)?.amountCents ?? 0}
              people={splitRows.map((s) => s.person)}
              shares={splitRows.map((s) => s.sharePercent)}
              onChangeShare={() => {}}
            />
          ) : null}
          {splitRows.map((s) => <ObligationRow key={s.id} name={s.person} remainingCents={Math.round((receiptRows.find((r) => r.id === splitReceiptId)?.amountCents ?? 0) * s.sharePercent / 100)} dueDate="split" kind="debt" />)}
        </Card>

        <ScrollView horizontal>
          <Box row gap={8}>
            <PlanCard title="Emergency fund" targetCents={200000} savedCents={85000} pace="8 paychecks left" />
          </Box>
        </ScrollView>
      </Screen>
    </FinanceUIProvider>
  );
}
