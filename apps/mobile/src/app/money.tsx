import React, { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import Svg, { Circle } from "react-native-svg";
import { useFocusEffect, useRouter } from "expo-router";
import { Badge, Button, Card, Empty, IconButton, Loading, Note, Screen, SectionTitle, Segmented, Text, TextField } from "../ui/primitives";
import { tokens, useTheme } from "../ui/theme";
import { transactions, deleteTransaction, getStores, saveTransactions, setTransactionStore } from "../db/money";
import { getSetting } from "../db/database";
import {
  accounts, addAccount, transfer, budgets, setBudget, deleteBudget,
  recurringList, addRecurring, deleteRecurring, bookmarks, addBookmark, deleteBookmark,
  type Account, type Budget, type Recurring, type Bookmark,
} from "../db/moneyTracker";
import { EMPTY_BANK_CONFIG, pullGoCardless, pullPlaid, type BankConfig } from "../lib/bank";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import type { BankProviderId, Store, Transaction } from "../lib/types";

type Period = "day" | "week" | "month" | "total";
const CHART_COLORS = ["#58CC02", "#CE82FF", "#1CB0F6", "#FFC800", "#FF9600", "#1CB0F6", "#CE82FF", "#AFAFAF"];

function periodPrefix(period: Period, startDay: number): string {
  const now = new Date();
  if (period === "day") return now.toISOString().slice(0, 10);
  if (period === "month") return core.periodStartKey(now, startDay);
  if (period === "week") return core.periodKey("week", now);
  return "";
}

function inPeriod(date: string, period: Period, startDay: number): boolean {
  const prefix = periodPrefix(period, startDay);
  if (period === "total") return true;
  if (period === "week") return core.periodKey("week", new Date(`${date}T12:00:00`)) === prefix;
  if (period === "month") return core.periodStartKey(new Date(`${date}T12:00:00`), startDay) === prefix;
  return date.startsWith(prefix);
}

function Donut({ rows, total }: { rows: { category: string; cents: number }[]; total: number }) {
  const { colors } = useTheme();
  const radius = 60;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <View style={styles.donutWrap}>
      <Svg width={160} height={160} viewBox="0 0 160 160">
        <Circle cx={80} cy={80} r={radius} stroke={colors.border} strokeWidth={18} fill="none" />
        {rows.map((row, index) => {
          const fraction = total > 0 ? row.cents / total : 0;
          const length = fraction * circumference;
          const dash = `${Math.max(0, length - 2)} ${circumference - Math.max(0, length - 2)}`;
          const segment = (
            <Circle
              key={row.category}
              cx={80} cy={80} r={radius}
              stroke={CHART_COLORS[index % CHART_COLORS.length]}
              strokeWidth={18} fill="none"
              strokeDasharray={dash}
              strokeDashoffset={-offset}
              transform="rotate(-90 80 80)"
            />
          );
          offset += length;
          return segment;
        })}
      </Svg>
      <View style={styles.donutCenter}>
        <Text variant="number">{core.formatEuro(total).replace(" €", "")}</Text>
        <Text variant="caption" color="muted">spent</Text>
      </View>
    </View>
  );
}

export default function MoneyScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const [period, setPeriod] = useState<Period>("month");
  const [startDay, setStartDay] = useState(1);
  const [rows, setRows] = useState<Transaction[]>([]);
  const [accountList, setAccountList] = useState<Account[]>([]);
  const [budgetList, setBudgetList] = useState<Budget[]>([]);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [bookmarkList, setBookmarkList] = useState<Bookmark[]>([]);
  const [stores, setStores] = useState<Store[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [provider, setProvider] = useState<BankProviderId>("csv");
  const [csv, setCsv] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [budgetCategory, setBudgetCategory] = useState("Groceries");
  const [budgetAmount, setBudgetAmount] = useState("");
  const [transferFrom, setTransferFrom] = useState("");
  const [transferTo, setTransferTo] = useState("");
  const [transferAmount, setTransferAmount] = useState("");
  const [recName, setRecName] = useState("");
  const [recAmount, setRecAmount] = useState("");
  const [recDay, setRecDay] = useState("1");
  const [bookmarkName, setBookmarkName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const [t, a, b, r, k, s] = await Promise.all([
      transactions(), accounts(), budgets(), recurringList(), bookmarks(), getStores(),
    ]);
    setRows(t);
    setAccountList(a);
    setBudgetList(b);
    setRecurring(r);
    setBookmarkList(k);
    setStores(s);
    setTransferFrom((prev) => prev || a[0]?.id || "");
    setTransferTo((prev) => prev || a[1]?.id || a[0]?.id || "");
    setLoading(false);
  }, []);

  useEffect(() => {
    void getSetting("startDay").then((value) => { const day = Number(value); if (day >= 1 && day <= 28) setStartDay(day); });
    void load();
  }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const scoped = useMemo(() => rows.filter((row) => inPeriod(row.date, period, startDay)), [rows, period, startDay]);
  const totals = core.txTotals(scoped, "");
  const categories = core.categoryTotals(scoped, "");
  const currentPeriod = periodPrefix(period, startDay);
  const periodName = period === "month" ? core.periodStartLabel(currentPeriod, startDay) : period === "total" ? "All time" : currentPeriod;
  const budgetStatus = core.budgetStatus(budgetList, core.categoryTotals(rows, core.periodStartKey(new Date(), startDay)));
  const scheduled = core.scheduled(recurring);
  const visible = scoped.filter((row) => row.merchant.toLowerCase().includes(search.toLowerCase()) || row.category.toLowerCase().includes(search.toLowerCase()));
  const accountBalance = accountList.reduce((sum, account) => sum + account.balanceCents, 0);

  const importCsv = useCallback(async () => {
    const { rows: parsed, errors } = core.parseTransactionCsv(csv);
    if (!parsed.length) { setMessage(errors[0] ?? "Nothing to import."); return; }
    const saved = await saveTransactions(parsed as unknown as Transaction[]);
    setCsv("");
    setMessage(`Imported ${saved} transactions. ${errors.length} lines skipped.`);
    await load();
  }, [csv, load]);

  const syncProvider = useCallback(async () => {
    setBusy(true);
    setMessage(null);
    try {
      const raw = await getSetting("bankConfig");
      const config: BankConfig = raw ? { ...EMPTY_BANK_CONFIG, ...(JSON.parse(raw) as Partial<BankConfig>) } : EMPTY_BANK_CONFIG;
      const pulled = provider === "plaid" ? await pullPlaid(config, stores) : provider === "gocardless" ? await pullGoCardless(config, stores) : [];
      const saved = await saveTransactions(pulled);
      setMessage(`Saved ${saved} new transactions from ${provider}.`);
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sync failed");
    } finally {
      setBusy(false);
    }
  }, [provider, stores, load]);

  const saveBudget = async () => {
    const cents = parseEuro(budgetAmount);
    if (cents === null) { setMessage("Enter a budget like 250."); return; }
    await setBudget(budgetCategory, cents);
    setBudgetAmount("");
    await load();
  };

  const doTransfer = async () => {
    const cents = parseEuro(transferAmount);
    if (cents === null || !transferFrom || !transferTo || transferFrom === transferTo) { setMessage("Pick two different accounts and an amount."); return; }
    await transfer(transferFrom, transferTo, cents);
    setTransferAmount("");
    await load();
  };

  const addRec = async () => {
    const cents = parseEuro(recAmount);
    const day = Number(recDay);
    if (cents === null || !recName.trim() || day < 1 || day > 28) { setMessage("Name, amount and day 1-28 required."); return; }
    await addRecurring({ name: recName.trim(), amountCents: cents, dayOfMonth: day, category: "Bills", active: 1 });
    setRecName(""); setRecAmount("");
    await load();
  };

  const addBm = async () => {
    if (!bookmarkName.trim()) return;
    await addBookmark(bookmarkName.trim(), 500, "Groceries");
    setBookmarkName("");
    await load();
  };

  return (
    <Screen
      title="Money"
      subtitle="Local ledger, budgets and accounts"
      action={
        <View style={styles.actions}>
          <IconButton icon="tools" label="Money tools" onPress={() => router.push("/moneytools")} />
          <IconButton icon="plus" label="Add transaction" onPress={() => router.push("/quickadd")} />
        </View>
      }
    >
      <Segmented
        value={period}
        onChange={setPeriod}
        options={[{ value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }, { value: "total", label: "Total" }]}
      />

      <Text variant="caption" color="muted">{periodName}</Text>
      <View style={styles.summary}>
        <Card tone="accent"><Text variant="number">{core.formatEuro(totals.balance)}</Text><Text variant="label" color="muted">Balance</Text></Card>
        <Card><Text variant="number">{core.formatEuro(totals.income)}</Text><Text variant="label" color="muted">Income</Text></Card>
        <Card><Text variant="number">{core.formatEuro(totals.expense)}</Text><Text variant="label" color="muted">Expense</Text></Card>
      </View>

      <Card>
        <SectionTitle>Spending by category</SectionTitle>
        <Donut rows={categories} total={totals.expense} />
        <View style={styles.legend}>
          {categories.slice(0, 8).map((row, index) => (
            <View key={row.category} style={styles.legendRow}>
              <View style={[styles.dot, { backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }]} />
              <Text variant="caption" style={styles.legendName}>{row.category}</Text>
              <Text variant="caption" color="muted">{core.formatEuro(row.cents)}</Text>
            </View>
          ))}
        </View>
        {!categories.length ? <Empty title="No spending yet" message="Add a transaction to see the breakdown." /> : null}
      </Card>

      <Card>
        <SectionTitle>Budgets</SectionTitle>
        {budgetStatus.map((status) => (
          <View key={status.category} style={styles.budgetRow}>
            <View style={styles.budgetHead}>
              <Text>{status.category}</Text>
              <Text variant="caption" color="muted">{`${core.formatEuro(status.spent)} / ${core.formatEuro(status.limit)}`}</Text>
              <IconButton icon="trash-can-outline" label={`Delete ${status.category} budget`} onPress={() => void deleteBudget(budgetList.find((b) => b.category === status.category)!.id).then(load)} />
            </View>
            <View style={[styles.bar, { backgroundColor: colors.border }]}>
              <View style={[styles.barFill, { backgroundColor: status.percent > 100 ? colors.danger : colors.accent, width: `${Math.min(100, status.percent)}%` }]} />
            </View>
            <Text variant="caption" color="muted">{`${status.percent}% · ${core.formatEuro(status.remaining)} left`}</Text>
          </View>
        ))}
        <TextField label="Category" value={budgetCategory} onChangeText={setBudgetCategory} />
        <TextField label="Monthly limit" value={budgetAmount} onChangeText={setBudgetAmount} keyboardType="decimal-pad" />
        <Button label="Save budget" icon="plus" onPress={() => void saveBudget()} />
      </Card>

      <Card>
        <SectionTitle>Accounts · {core.formatEuro(accountBalance)}</SectionTitle>
        {accountList.map((account) => (
          <View key={account.id} style={styles.row}>
            <Text style={styles.flex}>{account.name}</Text>
            <Text color="muted">{core.formatEuro(account.balanceCents)}</Text>
          </View>
        ))}
        <Button label="New account" tone="secondary" icon="plus" onPress={() => void addAccount("Account " + (accountList.length + 1)).then(load)} />
        <Segmented value={transferFrom} onChange={setTransferFrom} options={accountList.map((a) => ({ value: a.id, label: a.name }))} />
        <Segmented value={transferTo} onChange={setTransferTo} options={accountList.map((a) => ({ value: a.id, label: a.name }))} />
        <TextField label="Transfer amount" value={transferAmount} onChangeText={setTransferAmount} keyboardType="decimal-pad" />
        <Button label="Transfer" icon="swap-horizontal" onPress={() => void doTransfer()} />
      </Card>

      <Card>
        <SectionTitle>Scheduled payments</SectionTitle>
        {scheduled.map((row, index) => (
          <View key={`${row.name}-${index}`} style={styles.row}>
            <Text style={styles.flex}>{row.name}</Text>
            <Text variant="caption" color="muted">{row.nextDate}</Text>
            <Text color="muted">{core.formatEuro(row.amountCents)}</Text>
          </View>
        ))}
        <TextField label="New payment" value={recName} onChangeText={setRecName} />
        <TextField label="Amount" value={recAmount} onChangeText={setRecAmount} keyboardType="decimal-pad" />
        <TextField label="Day of month (1-28)" value={recDay} onChangeText={setRecDay} keyboardType="number-pad" />
        <Button label="Add scheduled payment" icon="plus" onPress={() => void addRec()} />
      </Card>

      <Card>
        <SectionTitle>Frequent expenses</SectionTitle>
        <View style={styles.legend}>
          {bookmarkList.map((bookmark) => (
            <Badge key={bookmark.id} label={`${bookmark.name} · ${core.formatEuro(bookmark.amountCents)}`} />
          ))}
        </View>
        <TextField label="Frequent item name" value={bookmarkName} onChangeText={setBookmarkName} />
        <Button label="Add frequent item" tone="secondary" icon="plus" onPress={() => void addBm()} disabled={!bookmarkName.trim()} />
      </Card>

      <Card>
        <SectionTitle>Connect a provider</SectionTitle>
        <Text variant="caption" color="muted">Plaid and GoCardless are called directly from this device. CSV stays fully offline.</Text>
        <Segmented value={provider} onChange={setProvider} options={[
          { value: "csv", label: "CSV" }, { value: "manual", label: "Manual" },
          { value: "plaid", label: "Plaid" }, { value: "gocardless", label: "GoCardless" },
        ]} />
        {provider === "csv" ? (
          <View style={styles.column}>
            <TextField label="Paste CSV (date;merchant;amount)" value={csv} onChangeText={setCsv} multiline />
            <Button label="Import CSV" icon="file-import" onPress={() => void importCsv()} disabled={!csv.trim()} />
          </View>
        ) : null}
        {provider === "manual" ? <Button label="Add a transaction" icon="plus" onPress={() => router.push("/quickadd")} /> : null}
        {provider === "plaid" || provider === "gocardless" ? (
          <Button label={busy ? "Syncing…" : `Sync ${provider}`} icon="sync" onPress={() => void syncProvider()} disabled={busy} />
        ) : null}
        {message ? <Note tone="info">{message}</Note> : null}
      </Card>

      <SectionTitle>Transactions</SectionTitle>
      {loading ? <Loading rows={3} /> : null}
      {!loading && !visible.length ? <Empty title="No transactions" message="Add one with the + button above." /> : null}
      <TextField label="Search transactions" value={search} onChangeText={setSearch} placeholder="Merchant or category" />
      {visible.map((row) => (
        <Card key={row.id}>
          <View style={styles.row}>
            <View style={styles.grow}>
              <Text>{row.merchant}</Text>
              <Text variant="caption" color="muted">{`${row.date} · ${row.category} · ${row.kind ?? "expense"}`}</Text>
            </View>
            <Text color={row.kind === "income" ? "success" : "danger"}>{core.formatEuro(row.amountCents)}</Text>
            <IconButton icon="trash-can-outline" label={`Delete ${row.merchant}`} onPress={() => void deleteTransaction(row.id).then(load)} />
          </View>
          <View style={styles.legend}>
            {stores.map((store) => <Badge key={store.id} label={store.name} tone={row.storeId === store.id ? "accent" : undefined} />)}
          </View>
          <View style={styles.legend}>
            {stores.map((store) => (
              <Button key={`assign-${store.id}`} label={store.name} tone="secondary" onPress={() => void setTransactionStore(row.id, store.id).then(load)} />
            ))}
          </View>
        </Card>
      ))}
    </Screen>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: "row", gap: tokens.xs },
  summary: { flexDirection: "row", gap: tokens.sm },
  donutWrap: { alignItems: "center", justifyContent: "center" },
  donutCenter: { position: "absolute", alignItems: "center" },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: tokens.sm },
  legendRow: { flexDirection: "row", alignItems: "center", gap: tokens.sm, width: "100%" },
  legendName: { flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  budgetRow: { gap: tokens.xs },
  budgetHead: { flexDirection: "row", alignItems: "center", gap: tokens.sm },
  bar: { height: 8, borderRadius: 4, overflow: "hidden" },
  barFill: { height: 8, borderRadius: 4 },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.sm },
  grow: { flex: 1, gap: 2 },
  flex: { flex: 1 },
  column: { gap: tokens.sm },
});
