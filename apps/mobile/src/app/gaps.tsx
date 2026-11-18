import React, { useCallback, useEffect, useState } from "react";
import { useColorScheme } from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as LocalAuthentication from "expo-local-authentication";
import { useRouter } from "expo-router";
import {
  Badge, Box, Button, Card, FinanceUIProvider, Money, PaymentProofRow, Segmented, Text,
  TextField, darkTheme, lightTheme,
} from "@finance/ui";
import { IconButton as AppIconButton, Screen, SectionTitle } from "../ui/primitives";
import { getSetting, setSetting } from "../db/database";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { allTransactions, accounts, recurringList, setBudget, goals, categories } from "../db/moneyTracker";
import { invoices } from "../db/appFeatures";
import {
  invoicePayments, addInvoicePayment, approveInvoicePayment,
  ocrReceipts, setOcrPhotos, setGoalPaused, goalFundings, fundGoal,
  setRecurringRule, setCategoryMeta, setAccountFees,
} from "../db/upstreamFeatures";
import { loadDemoData } from "../db/demo";

export default function GapsScreen() {
  const router = useRouter();
  const scheme = useColorScheme();
  const theme = scheme === "dark" ? darkTheme : lightTheme;
  const [locale, setLocale] = useState("en");
  const [timezone, setTimezone] = useState("UTC");
  const [payFrequency, setPayFrequency] = useState("monthly");
  const [piggy, setPiggy] = useState("0");
  const [biometrics, setBiometrics] = useState(false);
  const [summary, setSummary] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [txRows, setTxRows] = useState<Record<string, unknown>[]>([]);
  const [accountRows, setAccountRows] = useState<{ id: string; name: string; feesCents: number }[]>([]);
  const [categoryRows, setCategoryRows] = useState<{ name: string; type: string; archived: number }[]>([]);
  const [recurringRows, setRecurringRows] = useState<{ id: number; name: string; frequency: string; count: number; startDate: string }[]>([]);
  const [goalRows, setGoalRows] = useState<{ id: number; name: string; paused: number }[]>([]);
  const [fundingRows, setFundingRows] = useState<{ id: number; goalId: number; cents: number; date: string }[]>([]);
  const [ocrRows, setOcrRows] = useState<{ id: number; photosJson: string }[]>([]);
  const [invoiceRows, setInvoiceRows] = useState<{ id: number; number: string }[]>([]);
  const [paymentRows, setPaymentRows] = useState<{ id: number; invoiceId: number; cents: number; status: string }[]>([]);
  const [feeAccount, setFeeAccount] = useState("");
  const [feeAmount, setFeeAmount] = useState("");
  const [paymentInvoice, setPaymentInvoice] = useState<number | null>(null);
  const [paymentAmount, setPaymentAmount] = useState("");

  const load = useCallback(async () => {
    const [t, a, c, r, g, o, i, p, l, tz, pf, pg, bio] = await Promise.all([
      allTransactions(), accounts(), categories(), recurringList(), goals(), ocrReceipts(),
      invoices(), invoicePayments(), getSetting("locale"), getSetting("timezone"),
      getSetting("payFrequency"), getSetting("piggyCents"), getSetting("biometrics"),
    ]);
    setTxRows(t); setAccountRows(a as never); setCategoryRows(c as never); setRecurringRows(r as never);
    setGoalRows(g as never); setOcrRows(o as never); setInvoiceRows(i as never); setPaymentRows(p as never);
    setLocale(l ?? "en"); setTimezone(tz ?? "UTC"); setPayFrequency(pf ?? "monthly");
    setPiggy(String((Number(pg ?? 0) / 100).toFixed(2))); setBiometrics(bio === "1");
    setFeeAccount((prev) => prev || a[0]?.id || "");
    setPaymentInvoice((prev) => prev ?? i[0]?.id ?? null);
    setFundingRows(g.length ? await goalFundings(g[0].id) : []);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const saveSetting = async (key: string, value: string) => { await setSetting(key, value); await load(); };

  const toggleBiometrics = async () => {
    if (!biometrics) {
      const supported = await LocalAuthentication.hasHardwareAsync();
      if (supported) {
        const result = await LocalAuthentication.authenticateAsync({ promptMessage: "Enable biometric unlock" });
        if (!result.success) { setMessage("Biometric check failed."); return; }
      }
    }
    await saveSetting("biometrics", biometrics ? "0" : "1");
  };

  const pickPhotos = async () => {
    const receipt = ocrRows[0];
    if (!receipt) { setMessage("Save a receipt first."); return; }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, allowsMultipleSelection: true, selectionLimit: 5 });
    if (!result.canceled) {
      const current = JSON.parse(receipt.photosJson || "[]") as string[];
      const photos = [...current, ...result.assets.map((asset) => asset.uri)].slice(0, 5);
      await setOcrPhotos(receipt.id, JSON.stringify(photos));
      setMessage(`${photos.length} receipt photo(s) saved locally.`);
      await load();
    }
  };

  const schedule = () => {
    const dates = core.paycheckDates(new Date().toISOString().slice(0, 10), payFrequency, 6);
    setMessage(`Next paydays: ${dates.slice(0, 3).join(", ")}`);
  };

  const demo = async () => {
    const added = await loadDemoData();
    setMessage(added ? "Demo transactions loaded." : "Demo data already loaded.");
    await load();
  };

  return (
    <FinanceUIProvider theme={theme}>
      <Screen
        title="Parity gaps"
        subtitle="Remaining upstream features, implemented locally"
        back={<AppIconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
      >
        {message ? <Badge label={message} tone="primary" /> : null}

        <Card>
          <SectionTitle>Locale, timezone, biometrics, demo</SectionTitle>
          <Segmented value={locale} onChange={(v) => void saveSetting("locale", v)} options={[{ value: "en", label: "English" }, { value: "de", label: "Deutsch" }]} />
          <TextField label="Timezone" value={timezone} onChangeText={setTimezone} />
          <Button label="Save timezone" variant="secondary" onPress={() => void saveSetting("timezone", timezone)} />
          <Button label={biometrics ? "Disable biometrics" : "Enable biometrics"} icon="fingerprint" onPress={() => void toggleBiometrics()} />
          <Button label="Load demo data" icon="test-tube" variant="secondary" onPress={() => void demo()} />
          <Button label="AI-style local summary" icon="text" variant="secondary" onPress={() => setSummary(core.spendingSummary(txRows, locale))} />
          {summary ? <Text variant="body4">{summary}</Text> : null}
        </Card>

        <Card>
          <SectionTitle>Pay frequency &amp; Piggy reserve</SectionTitle>
          <Segmented value={payFrequency} onChange={setPayFrequency} options={[
            { value: "weekly", label: "Weekly" }, { value: "biweekly", label: "Biweekly" },
            { value: "semimonthly", label: "Semi" }, { value: "monthly", label: "Monthly" },
          ]} />
          <TextField label="Piggy reserve" value={piggy} onChangeText={setPiggy} numeric />
          <Button label="Save pay settings" icon="calendar" onPress={() => void saveSetting("payFrequency", payFrequency).then(() => saveSetting("piggyCents", String(Math.round((parseEuro(piggy) ?? 0)))))} />
          <Button label="Show next paydays" variant="secondary" onPress={schedule} />
          <Text variant="body4" color="muted">{`Monthly equivalent of 1,200.00: ${(core.paycheckProration(120000, payFrequency) / 100).toFixed(2)}`}</Text>
        </Card>

        <Card>
          <SectionTitle>Receipt photos (max 5)</SectionTitle>
          <Button label="Attach local photos" icon="image-multiple" onPress={() => void pickPhotos()} />
          {ocrRows.map((receipt) => {
            const photos = JSON.parse(receipt.photosJson || "[]") as string[];
            return <Badge key={receipt.id} label={`Receipt #${receipt.id}: ${photos.length} photo(s)`} />;
          })}
        </Card>

        <Card>
          <SectionTitle>Recurring rules</SectionTitle>
          {recurringRows.map((row) => (
            <Box key={row.id} gap={4}>
              <Text variant="body3">{row.name}</Text>
              <Segmented value={row.frequency} onChange={(v) => void setRecurringRule(row.id, v, row.count, row.startDate).then(load)} options={[
                { value: "weekly", label: "Weekly" }, { value: "monthly", label: "Monthly" }, { value: "yearly", label: "Yearly" },
              ]} />
              <Button label="Schedule 6 dates" variant="secondary" onPress={() => setMessage(core.scheduleRecurring([row], 6)[0]?.dates.join(", ") ?? "")} />
            </Box>
          ))}
        </Card>

        <Card>
          <SectionTitle>Goal pause &amp; funding ledger</SectionTitle>
          {goalRows.map((goal) => (
            <Box key={goal.id} gap={4}>
              <Box row style={{ justifyContent: "space-between" }}>
                <Text variant="body3">{goal.name}</Text>
                <Button label={goal.paused ? "Resume" : "Pause"} variant="secondary" onPress={() => void setGoalPaused(goal.id, !goal.paused).then(load)} />
              </Box>
              <Button label="Fund 10" onPress={() => void fundGoal(goal.id, 1000).then(load)} />
              {fundingRows.filter((f) => f.goalId === goal.id).map((f) => <Text key={f.id} variant="body5" color="muted">{`${f.date} · ${(f.cents / 100).toFixed(2)}`}</Text>)}
            </Box>
          ))}
        </Card>

        <Card>
          <SectionTitle>Category type &amp; archive</SectionTitle>
          {categoryRows.map((category) => (
            <Box key={category.name} row style={{ justifyContent: "space-between" }}>
              <Text variant="body3">{category.name}</Text>
              <Segmented value={category.type} onChange={(v) => void setCategoryMeta(category.name, v, !!category.archived).then(load)} options={[
                { value: "expense", label: "Expense" }, { value: "income", label: "Income" }, { value: "exclude", label: "Exclude" },
              ]} />
              <Button label={category.archived ? "Restore" : "Archive"} variant="secondary" onPress={() => void setCategoryMeta(category.name, category.type, !category.archived).then(load)} />
            </Box>
          ))}
        </Card>

        <Card>
          <SectionTitle>Account fees</SectionTitle>
          {accountRows.map((account) => <Text key={account.id} variant="body4">{`${account.name}: ${(account.feesCents / 100).toFixed(2)} fees`}</Text>)}
          <TextField label="Account" value={feeAccount} onChangeText={setFeeAccount} />
          <TextField label="Monthly fee" value={feeAmount} onChangeText={setFeeAmount} numeric />
          <Button label="Save fee" icon="plus" onPress={() => { const cents = parseEuro(feeAmount); if (cents !== null && feeAccount) void setAccountFees(feeAccount, cents).then(load); }} />
        </Card>

        <Card>
          <SectionTitle>Budget include children</SectionTitle>
          <Button label="Set Groceries rollover + children" variant="secondary" onPress={() => void setBudget("Groceries", 25000, 1200, true).then(load)} />
        </Card>

        <Card>
          <SectionTitle>Invoice payment approval</SectionTitle>
          {paymentRows.map((payment) => (
            <Box key={payment.id} row style={{ justifyContent: "space-between" }}>
              <PaymentProofRow method={`Invoice #${payment.invoiceId}`} cents={payment.cents} status={payment.status} />
              {payment.status !== "approved" ? <Button label="Approve" onPress={() => void approveInvoicePayment(payment.id).then(load)} /> : null}
            </Box>
          ))}
          <TextField label="Invoice id" value={paymentInvoice ? String(paymentInvoice) : ""} onChangeText={(v) => setPaymentInvoice(Number(v) || null)} />
          <TextField label="Amount" value={paymentAmount} onChangeText={setPaymentAmount} numeric />
          <Button label="Record payment" icon="plus" onPress={() => { const cents = parseEuro(paymentAmount); if (cents !== null && paymentInvoice && accountRows[0]) void addInvoicePayment(paymentInvoice, 1, cents).then(load); }} />
        </Card>
      </Screen>
    </FinanceUIProvider>
  );
}
