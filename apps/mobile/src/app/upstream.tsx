import React, { useCallback, useEffect, useState } from "react";
import { useColorScheme, View } from "react-native";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system";
import { useRouter } from "expo-router";
import {
  Badge, BillConfirmationCard, Box, Card, ChatCommandBar, CreditCommitmentCard,
  ExcelImportCard, FinanceUIProvider, GoldCard, OcrReceiptCard, Onboarding, PaymentProofRow,
  ProjectCard, ReceivableRow, SubscriptionRow, Text, TextField, Button, darkTheme, lightTheme, Icon,
} from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle } from "../ui/primitives";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { saveTransactions } from "../db/money";
import { addMoneyTransaction } from "../db/moneyTracker";
import {
  gold, addGold, receivables, addReceivable, payReceivable, subscriptions, addSubscription,
  chatLogs, logCommand, ocrReceipts, addOcrReceipt, paymentMethods, addPaymentMethod,
  projectGroups, projects, projectPurchases, addProjectGroup, addProject, addProjectPurchase,
  billConfirmations, saveBillConfirmation, creditCommitments, addCreditCommitment,
  onboardingDone, completeOnboarding,
} from "../db/upstreamFeatures";

const ONBOARDING = [
  { title: "Welcome", body: "One local app for recipes, groceries and money. No account, no server." },
  { title: "Your data", body: "Everything is stored on this device. Back up and share files whenever you like." },
  { title: "Ready", body: "Add a transaction, save a recipe and build your weekly shopping list." },
];

export default function UpstreamScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const theme = scheme === "dark" ? darkTheme : lightTheme;
  const [ready, setReady] = useState(false);
  const [goldRows, setGoldRows] = useState<{ id: number; name: string; grams: number; buyCentsPerGram: number; currentCentsPerGram: number }[]>([]);
  const [receivableRows, setReceivableRows] = useState<{ id: number; name: string; totalCents: number; paidCents: number; dueDate: string }[]>([]);
  const [subscriptionRows, setSubscriptionRows] = useState<{ id: number; name: string; amountCents: number; interval: string; startDate: string; taxPercent: number }[]>([]);
  const [logs, setLogs] = useState<{ id: number; command: string }[]>([]);
  const [ocrRows, setOcrRows] = useState<{ id: number; merchant: string; amountCents: number; itemsJson: string; uri: string }[]>([]);
  const [methods, setMethods] = useState<{ id: number; name: string; kind: string }[]>([]);
  const [groups, setGroups] = useState<{ id: number; name: string }[]>([]);
  const [projectRows, setProjectRows] = useState<{ id: number; groupId: number; name: string; targetCents: number }[]>([]);
  const [purchaseRows, setPurchaseRows] = useState<{ id: number; projectId: number; name: string; cents: number; funded: number }[]>([]);
  const [billRows, setBillRows] = useState<{ id: number; billCents: number; paidCents: number; resultJson: string }[]>([]);
  const [creditRows, setCreditRows] = useState<{ id: number; name: string; balanceCents: number; monthlyCents: number; aprPercent: number }[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [goldName, setGoldName] = useState("Gold");
  const [goldGrams, setGoldGrams] = useState("5");
  const [goldBuy, setGoldBuy] = useState("5000");
  const [goldNow, setGoldNow] = useState("6000");
  const [recName, setRecName] = useState("");
  const [recAmount, setRecAmount] = useState("");
  const [recDue, setRecDue] = useState("");
  const [subName, setSubName] = useState("");
  const [subAmount, setSubAmount] = useState("");
  const [command, setCommand] = useState("");
  const [ocrMerchant, setOcrMerchant] = useState("");
  const [ocrItems, setOcrItems] = useState("");
  const [methodName, setMethodName] = useState("");
  const [groupName, setGroupName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [purchaseName, setPurchaseName] = useState("");
  const [purchaseAmount, setPurchaseAmount] = useState("");
  const [billAmount, setBillAmount] = useState("");
  const [paidAmount, setPaidAmount] = useState("");
  const [creditName, setCreditName] = useState("");
  const [creditBalance, setCreditBalance] = useState("");
  const [creditMonthly, setCreditMonthly] = useState("");

  const load = useCallback(async () => {
    const [g, r, s, l, o, m, pg, p, pp, b, c] = await Promise.all([
      gold(), receivables(), subscriptions(), chatLogs(), ocrReceipts(), paymentMethods(),
      projectGroups(), projects(), projectPurchases(), billConfirmations(), creditCommitments(),
    ]);
    setGoldRows(g); setReceivableRows(r); setSubscriptionRows(s);
    setLogs(l); setOcrRows(o); setMethods(m); setGroups(pg);
    setProjectRows(p); setPurchaseRows(pp); setBillRows(b); setCreditRows(c);
  }, []);

  useEffect(() => {
    void onboardingDone().then((done) => { setReady(done); void load(); });
  }, [load]);

  const runCommand = async () => {
    const parsed = core.chatCommand(command);
    const json = JSON.stringify(parsed);
    await logCommand(command, json);
    if (parsed.kind !== "unknown" && parsed.kind !== "undo" && parsed.cents > 0) {
      await addMoneyTransaction({
        date: new Date().toISOString().slice(0, 10), merchant: parsed.merchant, amountCents: parsed.cents,
        category: parsed.category, kind: parsed.kind === "income" ? "income" : "expense", accountId: "bank",
      });
      setMessage(`Logged ${(parsed.cents / 100).toFixed(2)} to ${parsed.category}`);
    }
    setCommand("");
    await load();
  };

  const importXlsx = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "*/*", copyToCacheDirectory: true });
    if (result.canceled) return;
    const picked = result as unknown as { assets?: { uri: string }[]; uri?: string };
    const uri = picked.assets?.[0]?.uri ?? picked.uri;
    if (!uri) return;
    try {
      const base64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
      const rows = core.xlsxImport(base64);
      const saved = await saveTransactions(rows as never);
      setMessage(`Imported ${saved} XLSX rows.`);
    } catch (e) { setMessage(e instanceof Error ? e.message : "XLSX import failed"); }
  };

  if (!ready) {
    return (
      <FinanceUIProvider theme={theme}>
        <Screen title="Setup" subtitle="Three quick steps">
          <Onboarding steps={ONBOARDING} onDone={() => void completeOnboarding().then(() => setReady(true))} />
        </Screen>
      </FinanceUIProvider>
    );
  }

  const nextReceivable = receivableRows[0];
  const nextSubscription = subscriptionRows[0];
  const nextProject = projectRows[0];

  return (
    <FinanceUIProvider theme={theme}>
      <Screen
        title="Upstream features"
        subtitle="Pockaw · Dompetku · Boring Balance · Jings"
        back={<AppIconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
      >
        {message ? <Badge label={message} tone="primary" /> : null}
        <Button label="Parity gaps and settings" icon="tune" variant="secondary" onPress={() => router.push("/gaps")} />

        <Card>
          <SectionTitle>Category artwork (Pockaw)</SectionTitle>
          <Box row gap={8}>
            {["Groceries", "Transport", "Shopping", "Leisure", "Bills"].map((category) => (
              <Box key={category} gap={4}><Box style={{ width: 40, height: 40, borderRadius: 12, backgroundColor: "#E6F4F1", alignItems: "center", justifyContent: "center" }}><Icon name="shape-outline" size={20} /></Box><Text variant="body5">{category}</Text></Box>
            ))}
          </Box>
        </Card>

        <Card>
          <SectionTitle>Gold (Dompetku)</SectionTitle>
          {goldRows.map((g) => {
            const p = core.goldProfit(g.grams, g.buyCentsPerGram, g.currentCentsPerGram);
            return <GoldCard key={g.id} name={g.name} grams={g.grams} costCents={p.cost} valueCents={p.value} profitCents={p.profit} />;
          })}
          <TextField label="Name" value={goldName} onChangeText={setGoldName} />
          <Box row gap={8}>
            <TextField label="Grams" value={goldGrams} onChangeText={setGoldGrams} numeric />
            <TextField label="Buy/g" value={goldBuy} onChangeText={setGoldBuy} numeric />
            <TextField label="Now/g" value={goldNow} onChangeText={setGoldNow} numeric />
          </Box>
          <Button label="Add gold" icon="plus" onPress={() => void addGold(goldName, Number(goldGrams) || 1, parseEuro(goldBuy) ?? 0, parseEuro(goldNow) ?? 0).then(load)} />
        </Card>

        <Card>
          <SectionTitle>Receivables &amp; subscriptions</SectionTitle>
          {core.receivableStatus(receivableRows).map((r, index) => <ReceivableRow key={index} name={r.name} remainingCents={r.remaining} dueDate={r.dueDate} overdue={r.overdue} />)}
          <TextField label="Receivable" value={recName} onChangeText={setRecName} />
          <Box row gap={8}>
            <TextField label="Amount" value={recAmount} onChangeText={setRecAmount} numeric />
            <TextField label="Due" value={recDue} onChangeText={setRecDue} placeholder="YYYY-MM-DD" />
          </Box>
          <Button label="Add receivable" icon="plus" onPress={() => { const cents = parseEuro(recAmount); if (cents !== null && recName) void addReceivable(recName, cents, recDue).then(() => { setRecName(""); setRecAmount(""); void load(); }); }} />
          {nextReceivable ? <Button label="Record partial payment" variant="secondary" onPress={() => void payReceivable(nextReceivable.id, 1000).then(load)} /> : null}
          {core.subscriptionNext(subscriptionRows).map((s, index) => <SubscriptionRow key={index} name={s.name} amountCents={s.amountCents} interval={s.interval} nextDate={s.nextDate} />)}
          <TextField label="Subscription" value={subName} onChangeText={setSubName} />
          <Box row gap={8}>
            <TextField label="Amount" value={subAmount} onChangeText={setSubAmount} numeric />
            <TextField label="Interval" value="monthly" onChangeText={() => {}} />
          </Box>
          <Button label="Add subscription" icon="plus" onPress={() => { const cents = parseEuro(subAmount); if (cents !== null && subName) void addSubscription(subName, cents, "monthly", new Date().toISOString().slice(0, 10), 0).then(() => { setSubName(""); setSubAmount(""); void load(); }); }} />
        </Card>

        <ChatCommandBar value={command} onChange={setCommand} onSubmit={() => void runCommand()} last={logs[0]?.command} />

        <Card>
          <SectionTitle>Receipt capture (local)</SectionTitle>
          <TextField label="Shop" value={ocrMerchant} onChangeText={setOcrMerchant} />
          <TextField label="Items (one per line)" value={ocrItems} onChangeText={setOcrItems} multiline />
          <Button label="Save receipt lines" icon="receipt" onPress={() => {
            const parsed = core.parseReceipt(ocrItems);
            const total = parsed.reduce((sum, item) => sum + item.cents, 0);
            if (!ocrMerchant || !parsed.length) return;
            void addOcrReceipt(ocrMerchant, total, JSON.stringify(parsed.map((p) => p.name))).then(() => { setOcrMerchant(""); setOcrItems(""); void load(); });
          }} />
          {ocrRows.map((r) => <OcrReceiptCard key={r.id} merchant={r.merchant} amountCents={r.amountCents} items={JSON.parse(r.itemsJson || "[]") as string[]} uri={r.uri} />)}
        </Card>

        <Card>
          <SectionTitle>Payment methods</SectionTitle>
          {methods.map((m) => <PaymentProofRow key={m.id} method={m.name} cents={0} status="ready" />)}
          <TextField label="New method" value={methodName} onChangeText={setMethodName} />
          <Button label="Add method" icon="plus" onPress={() => { if (methodName) void addPaymentMethod(methodName, "bank").then(() => { setMethodName(""); void load(); }); }} />
        </Card>

        <ExcelImportCard onPick={() => void importXlsx()} />

        <Card>
          <SectionTitle>Projects (Jings)</SectionTitle>
          <TextField label="New group" value={groupName} onChangeText={setGroupName} />
          <Button label="Add group" icon="plus" onPress={() => { if (groupName) void addProjectGroup(groupName).then(() => { setGroupName(""); void load(); }); }} />
          <TextField label="New project" value={projectName} onChangeText={setProjectName} />
          <Button label="Add project" icon="plus" onPress={() => { if (projectName && groups[0]) void addProject(groups[0].id, projectName, 0).then(() => { setProjectName(""); void load(); }); }} />
          <TextField label="Purchase" value={purchaseName} onChangeText={setPurchaseName} />
          <TextField label="Cost" value={purchaseAmount} onChangeText={setPurchaseAmount} numeric />
          <Button label="Add purchase" icon="plus" onPress={() => { const cents = parseEuro(purchaseAmount); if (cents !== null && purchaseName && nextProject) void addProjectPurchase(nextProject.id, purchaseName, cents, false).then(() => { setPurchaseName(""); setPurchaseAmount(""); void load(); }); }} />
          {nextProject ? (() => {
            const items = purchaseRows.filter((p) => p.projectId === nextProject.id).map((p) => ({ name: p.name, cents: p.cents }));
            const funding = core.projectFunding(items, 5000);
            return <ProjectCard name={nextProject.name} targetCents={nextProject.targetCents} items={funding.items} unusedCents={funding.unused} />;
          })() : null}
        </Card>

        <Card>
          <SectionTitle>Bill confirmation</SectionTitle>
          <Box row gap={8}>
            <TextField label="Bill" value={billAmount} onChangeText={setBillAmount} numeric />
            <TextField label="Paid" value={paidAmount} onChangeText={setPaidAmount} numeric />
          </Box>
          <Button label="Confirm bill" icon="check" onPress={() => { const bill = parseEuro(billAmount); const paid = parseEuro(paidAmount); if (bill !== null && paid !== null) void saveBillConfirmation(bill, paid, JSON.stringify(core.billConfirm(bill, paid))).then(() => { setBillAmount(""); setPaidAmount(""); void load(); }); }} />
          {billRows.map((b, index) => {
            const result = core.billConfirm(b.billCents, b.paidCents);
            return <BillConfirmationCard key={index} billCents={b.billCents} paidCents={b.paidCents} overage={result.overage} shortfall={result.shortfall} plan={result.recoveryPlan} />;
          })}
        </Card>

        <Card>
          <SectionTitle>Credit-card commitments</SectionTitle>
          <TextField label="Card" value={creditName} onChangeText={setCreditName} />
          <Box row gap={8}>
            <TextField label="Balance" value={creditBalance} onChangeText={setCreditBalance} numeric />
            <TextField label="Monthly" value={creditMonthly} onChangeText={setCreditMonthly} numeric />
          </Box>
          <Button label="Add commitment" icon="plus" onPress={() => { const balance = parseEuro(creditBalance); const monthly = parseEuro(creditMonthly); if (balance !== null && monthly !== null && creditName) void addCreditCommitment(creditName, balance, monthly, 18).then(() => { setCreditName(""); setCreditBalance(""); setCreditMonthly(""); void load(); }); }} />
          {creditRows.map((c) => {
            const payoff = core.creditPayoff(c.balanceCents, c.monthlyCents, c.aprPercent);
            return <CreditCommitmentCard key={c.id} name={c.name} balanceCents={c.balanceCents} months={payoff.months} interestCents={payoff.interest} />;
          })}
        </Card>
      </Screen>
    </FinanceUIProvider>
  );
}
