import React, { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import {
  AsyncBoundary, Box, Button, Card, Chip, FadeIn, FgHeaderIcon, FgScreen, FgSection,
  Segmented, Text, TextField,
} from "@finance/ui";
import { fgEuro } from "@finance/ui";
import { parseEuro } from "../lib/money";
import {
  doTransfer, loadBookings, loadFlowAccounts, loadFlowSettings, rebook, recordRefund,
  saveFlowSetting, splitBill, type Account, type Booking, type FlowSettings,
} from "../lib/flows";

type Mode = "transfer" | "refund" | "rebook" | "split" | "plus";
const CATEGORIES = ["Groceries", "Streaming", "Transport", "Living", "Leisure", "Shopping", "Refund", "Uncategorised"];

export default function FlowsScreen() {
  const router = useRouter();
  const [tab, setTab] = useState<Mode>("transfer");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [settings, setSettings] = useState<FlowSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [selected, setSelected] = useState<Booking | null>(null);
  const [category, setCategory] = useState("Groceries");
  const [people, setPeople] = useState("3");
  const [splitMode, setSplitMode] = useState<"equal" | "amount" | "percent">("equal");
  const [shares, setShares] = useState("");
  const [result, setResult] = useState<number[]>([]);

  const load = () => {
    setLoading(true);
    void Promise.all([loadFlowAccounts(), loadBookings(), loadFlowSettings()])
      .then(([a, b, s]) => {
        setAccounts(a); setBookings(b); setSettings(s);
        if (a.length && !from) { setFrom(a[0].id); setTo(a[1]?.id ?? a[0].id); }
        setError(null);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load money flows"))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const act = async (fn: () => Promise<void>, ok: string) => {
    try { await fn(); setMessage(ok); load(); }
    catch (e) { setMessage(e instanceof Error ? e.message : "Could not complete"); }
  };

  return (
    <FgScreen
      title="Money flows"
      actions={<FgHeaderIcon name="view-grid" label="All apps" onPress={() => router.push("/hub")} />}
    >
      <Segmented value={tab} onChange={(v) => { setTab(v); setMessage(null); }} options={[
        { value: "transfer", label: "Transfer" }, { value: "refund", label: "Refund" },
        { value: "rebook", label: "Rebook" }, { value: "split", label: "Split" }, { value: "plus", label: "Plus" },
      ]} />
      {message ? <Text variant="body3" color="income">{message}</Text> : null}
      <AsyncBoundary loading={loading} error={error} onRetry={load} rows={4}>
        {tab === "transfer" && (
          <FadeIn>
            <FgSection title="Transfer between accounts">
              <Card>
                <Text variant="body4" color="muted">Moves money locally between your accounts and updates both balances.</Text>
                <Text variant="body4" color="muted">From</Text>
                <Box row gap={8} style={{ flexWrap: "wrap" }}>
                  {accounts.map((a) => <Chip key={`f-${a.id}`} label={a.name} selected={from === a.id} onPress={() => setFrom(a.id)} />)}
                </Box>
                <Text variant="body4" color="muted">To</Text>
                <Box row gap={8} style={{ flexWrap: "wrap" }}>
                  {accounts.map((a) => <Chip key={`t-${a.id}`} label={a.name} selected={to === a.id} onPress={() => setTo(a.id)} />)}
                </Box>
                <TextField label="Amount" value={amount} onChangeText={setAmount} numeric placeholder="e.g. 25,00" />
                <Button label="Transfer" icon="swap-horizontal" onPress={() => {
                  const cents = parseEuro(amount);
                  if (cents === null) { setMessage("Enter an amount like 25,00."); return; }
                  void act(() => doTransfer(from, to, cents), "Transfer saved locally.");
                }} />
              </Card>
            </FgSection>
          </FadeIn>
        )}

        {tab === "refund" && (
          <FadeIn>
            <FgSection title="Record a refund">
              <Card>
                <Text variant="body4" color="muted">Select an expense, then record the amount credited back to your account.</Text>
                {bookings.filter((b) => b.kind !== "income").slice(0, 8).map((b) => (
                  <Chip key={b.id} label={`${b.merchant} · ${fgEuro(Math.abs(b.amountCents), false)}`}
                    selected={selected?.id === b.id} onPress={() => { setSelected(b); setAmount((Math.abs(b.amountCents) / 100).toFixed(2).replace(".", ",")); }} />
                ))}
                <TextField label="Refunded amount" value={amount} onChangeText={setAmount} numeric />
                <Button label="Record refund" icon="undo" disabled={!selected} onPress={() => {
                  if (!selected) return;
                  const cents = parseEuro(amount);
                  if (cents === null) { setMessage("Enter a valid amount."); return; }
                  void act(() => recordRefund(selected, cents), "Refund recorded as income.");
                }} />
              </Card>
            </FgSection>
          </FadeIn>
        )}

        {tab === "rebook" && (
          <FadeIn>
            <FgSection title="Rebook a transaction">
              <Card>
                <Text variant="body4" color="muted">Change the category of a booking. Insights and budgets update immediately.</Text>
                {bookings.slice(0, 8).map((b) => (
                  <Chip key={b.id} label={`${b.merchant} · ${b.category}`} selected={selected?.id === b.id}
                    onPress={() => { setSelected(b); setCategory(b.category); }} />
                ))}
                <Box row gap={8} style={{ flexWrap: "wrap" }}>
                  {CATEGORIES.map((c) => <Chip key={c} label={c} selected={category === c} onPress={() => setCategory(c)} />)}
                </Box>
                <Button label="Save category" icon="check" disabled={!selected} onPress={() => {
                  if (!selected) return;
                  void act(() => rebook(selected, category), "Booking rebooked.");
                }} />
              </Card>
            </FgSection>
          </FadeIn>
        )}

        {tab === "split" && (
          <FadeIn>
            <FgSection title="Split a bill">
              <Card>
                <TextField label="Total amount" value={amount} onChangeText={setAmount} numeric placeholder="e.g. 84,60" />
                <TextField label="People" value={people} onChangeText={setPeople} numeric />
                <Segmented value={splitMode} onChange={setSplitMode} options={[
                  { value: "equal", label: "Equal" }, { value: "amount", label: "By amount" }, { value: "percent", label: "By %" },
                ]} />
                {splitMode !== "equal" ? <TextField label="Shares (comma separated)" value={shares} onChangeText={setShares} placeholder="e.g. 20,30,50" /> : null}
                <Button label="Calculate split" icon="calculator" onPress={() => {
                  const cents = parseEuro(amount);
                  if (cents === null) { setMessage("Enter a valid amount."); return; }
                  const list = shares.split(/[, ]+/).map((s) => Number(s.replace(",", "."))).filter(Number.isFinite);
                  setResult(splitBill(cents, Number(people) || 2, splitMode, list));
                }} />
                {result.map((cents, i) => (
                  <Box key={i} row style={{ justifyContent: "space-between" }}>
                    <Text variant="body3">{`Person ${i + 1}`}</Text>
                    <Text variant="numericMedium">{fgEuro(cents)}</Text>
                  </Box>
                ))}
                {result.length ? <Text variant="body5" color="muted">{`Total: ${fgEuro(result.reduce((s, c) => s + c, 0))}`}</Text> : null}
              </Card>
            </FgSection>
          </FadeIn>
        )}

        {tab === "plus" && settings && (
          <FadeIn>
            <FgSection title="Plus & settings">
              <Card>
                <Text variant="heading5">{settings.plusActive ? "Finanzguru Plus" : "Free plan"}</Text>
                <Text variant="body3" color="muted">{settings.plusActive
                  ? "Unlimited analyses, budgets and forecasts enabled locally."
                  : "Free: accounts, contracts, cancellation and 3 months of analysis. Plus enables unlimited analysis locally."}</Text>
                <Button label={settings.plusActive ? "Use free plan" : "Enable Plus locally"} icon="crown"
                  onPress={() => void act(() => saveFlowSetting("plusActive", !settings.plusActive), settings.plusActive ? "Free plan active." : "Plus enabled locally.")} />
                <TextField label="Promo code" value={settings.promoCode} onChangeText={(v) => { setSettings({ ...settings, promoCode: v }); }}
                  placeholder="Enter code" />
                <Button label="Save promo code" variant="secondary" onPress={() => void act(() => saveFlowSetting("promoCode", settings.promoCode), "Promo code saved locally.")} />
              </Card>
              <Card>
                <Text variant="heading5">Preferences</Text>
                <Text variant="body4" color="muted">Language</Text>
                <Box row gap={8}>
                  <Chip label="English" selected={settings.locale === "English"} onPress={() => void act(() => saveFlowSetting("locale", "English"), "Language saved.")} />
                  <Chip label="Deutsch" selected={settings.locale === "Deutsch"} onPress={() => void act(() => saveFlowSetting("locale", "Deutsch"), "Sprache gespeichert.")} />
                </Box>
                <TextField label="Timezone" value={settings.timezone} onChangeText={(v) => setSettings({ ...settings, timezone: v })} />
                <TextField label="Payday start day (1–28)" value={settings.startDay} onChangeText={(v) => setSettings({ ...settings, startDay: v })} numeric />
                <Button label="Save preferences" variant="secondary" onPress={() => void act(async () => {
                  await saveFlowSetting("timezone", settings.timezone);
                  await saveFlowSetting("startDay", settings.startDay);
                }, "Preferences saved.")} />
                <Chip label={`Biometrics ${settings.biometrics ? "on" : "off"}`} selected={settings.biometrics}
                  onPress={() => void act(() => saveFlowSetting("biometrics", !settings.biometrics), "Biometric preference saved.")} />
                <Button label="Advanced settings" variant="tertiary" onPress={() => router.push("/settings")} />
              </Card>
            </FgSection>
          </FadeIn>
        )}
      </AsyncBoundary>
    </FgScreen>
  );
}
