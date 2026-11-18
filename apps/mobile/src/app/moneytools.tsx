import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Badge, Button, Card, Empty, IconButton, Note, Screen, SectionTitle, Segmented, Text, TextField } from "../ui/primitives";
import { tokens } from "../ui/theme";
import {
  accounts, rates, setRate, setCardDetails, setAccountCurrency,
  debts, addDebt, payDebt, deleteDebt, standingOrders, addStandingOrder, deleteStandingOrder,
  addMoneyTransaction, categories, addCategory, goals, addGoal, contributeGoal, deleteGoal,
  receipts, addReceipt, deleteReceipt, ledgerEntries, allTransactions,
  type Account, type Rate, type Debt, type StandingOrder, type Category, type Goal, type Receipt, type LedgerEntry,
} from "../db/moneyTracker";
import { recurringList } from "../db/moneyTracker";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import { exportBackup, importBackup, loadSharedSnapshot, sharedTransactions, clearSharedSnapshot } from "../db/backup";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as DocumentPicker from "expo-document-picker";
import { scheduleDueNotifications } from "../native/notifications";

export default function MoneyToolsScreen() {
  const router = useRouter();
  const [accountList, setAccountList] = useState<Account[]>([]);
  const [rateList, setRateList] = useState<Rate[]>([]);
  const [debtList, setDebtList] = useState<Debt[]>([]);
  const [orderList, setOrderList] = useState<StandingOrder[]>([]);
  const [categoryList, setCategoryList] = useState<Category[]>([]);
  const [goalList, setGoalList] = useState<Goal[]>([]);
  const [receiptList, setReceiptList] = useState<Receipt[]>([]);
  const [partnerRows, setPartnerRows] = useState<Record<string, unknown>[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]);
  const [tagRows, setTagRows] = useState<Record<string, unknown>[]>([]);
  const [tagFilter, setTagFilter] = useState("");
  const [catName, setCatName] = useState("");
  const [catParent, setCatParent] = useState("Leisure");
  const [goalName, setGoalName] = useState("");
  const [goalTarget, setGoalTarget] = useState("");
  const [goalDue, setGoalDue] = useState("");
  const [receiptMerchant, setReceiptMerchant] = useState("");
  const [receiptAmount, setReceiptAmount] = useState("");
  const [receiptWarranty, setReceiptWarranty] = useState("");
  const [receiptTags, setReceiptTags] = useState("");
  const [reminders, setReminders] = useState<{ name: string; nextDate: string; amountCents: number }[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const [convertAmount, setConvertAmount] = useState("100");
  const [convertFrom, setConvertFrom] = useState("EUR");
  const [convertTo, setConvertTo] = useState("USD");
  const [rateCode, setRateCode] = useState("USD");
  const [rateValue, setRateValue] = useState("1,1");

  const [cardId, setCardId] = useState("");
  const [cardDay, setCardDay] = useState("1");
  const [cardOutstanding, setCardOutstanding] = useState("0");

  const [receiptText, setReceiptText] = useState("");
  const [splitAmount, setSplitAmount] = useState("20");
  const [splitCount, setSplitCount] = useState("3");
  const [splitMode, setSplitMode] = useState<"equal" | "amount" | "percent">("equal");
  const [splitShares, setSplitShares] = useState("");
  const [splitResult, setSplitResult] = useState<number[] | null>(null);

  const [debtName, setDebtName] = useState("");
  const [debtTotal, setDebtTotal] = useState("");
  const [debtDue, setDebtDue] = useState("");
  const [backupJson, setBackupJson] = useState("");
  const [importJson, setImportJson] = useState("");
  const [orderName, setOrderName] = useState("");
  const [orderAmount, setOrderAmount] = useState("");
  const [orderDay, setOrderDay] = useState("1");

  const load = useCallback(async () => {
    const [a, r, d, o, rec, cats, gl, rc, lg, tx, partner] = await Promise.all([
      accounts(), rates(), debts(), standingOrders(), recurringList(),
      categories(), goals(), receipts(), ledgerEntries(), allTransactions(), sharedTransactions(),
    ]);
    setAccountList(a);
    setRateList(r);
    setDebtList(d);
    setOrderList(o);
    setCategoryList(cats);
    setGoalList(gl);
    setReceiptList(rc);
    setLedger(lg);
    setTagRows(tx);
    setPartnerRows(partner);
    setCardId((prev) => prev || a.find((x) => x.kind === "credit")?.id || a[0]?.id || "");
    const due = core.dueSoon(core.scheduled(rec), 7) as typeof reminders;
    setReminders(due);
    void scheduleDueNotifications(due);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const shareBackup = async () => {
    const json = await exportBackup();
    const uri = `${FileSystem.Paths.cache.uri}pantry-backup.json`;
    await FileSystem.writeAsStringAsync(uri, json, { encoding: FileSystem.EncodingType.UTF8 });
    if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(uri, { mimeType: "application/json", dialogTitle: "Pantry backup" });
    else setBackupJson(json);
  };

  const pickBackup = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
    if (result.canceled) return;
    const picked = result as unknown as { assets?: { uri: string }[]; uri?: string };
    const uri = picked.assets?.[0]?.uri ?? picked.uri;
    if (!uri) return;
    setImportJson(await FileSystem.readAsStringAsync(uri));
  };

  const pickPartnerBackup = async () => {
    const result = await DocumentPicker.getDocumentAsync({ type: "application/json", copyToCacheDirectory: true });
    if (result.canceled) return;
    const picked = result as unknown as { assets?: { uri: string }[]; uri?: string };
    const uri = picked.assets?.[0]?.uri ?? picked.uri;
    if (!uri) return;
    try {
      await loadSharedSnapshot(await FileSystem.readAsStringAsync(uri));
      await load();
      setMessage("Partner backup loaded. Combined totals are below.");
    } catch (e) { setMessage(e instanceof Error ? e.message : "Could not load partner backup"); }
  };

  const doConvert = () => {
    const cents = parseEuro(convertAmount);
    if (cents === null) { setMessage("Enter an amount."); return; }
    const result = core.convert(cents, convertFrom, convertTo, rateList);
    setMessage(result === null ? "Unknown currency." : `${convertAmount} ${convertFrom} = ${core.formatMoney(result, convertTo)}`);
  };

  const saveRate = async () => {
    const value = Number(rateValue.replace(",", "."));
    if (!value || value <= 0) { setMessage("Invalid rate."); return; }
    await setRate(rateCode, value);
    await load();
  };

  const saveCard = async () => {
    const cents = parseEuro(cardOutstanding);
    if (cents === null || !cardId) return;
    await setCardDetails(cardId, Number(cardDay) || 1, cents);
    await load();
  };

  const importReceipt = async () => {
    const items = core.parseReceipt(receiptText);
    if (!items.length) { setMessage("No receipt lines found. Example: Milk 1,29"); return; }
    for (const item of items) {
      await addMoneyTransaction({ date: new Date().toISOString().slice(0, 10), merchant: item.name, amountCents: item.cents, category: "Groceries", kind: "expense", accountId: cardId || accountList[0]?.id || "" });
    }
    setReceiptText("");
    setMessage(`Imported ${items.length} receipt lines.`);
  };

  const doSplit = () => {
    const cents = parseEuro(splitAmount);
    const count = Number(splitCount);
    if (cents === null || count < 2) { setMessage("Amount and at least 2 people required."); return; }
    const shares = splitShares.split(/[, ]+/).map((x) => Number(x.replace(",", "."))).filter((x) => Number.isFinite(x));
    setSplitResult(core.splitBill(cents, count, splitMode, shares));
  };

  return (
    <Screen
      title="Money tools"
      subtitle="Passcode, currencies, cards, reports and more"
      back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
    >
      {message ? <Note tone="success">{message}</Note> : null}

      <Card>
        <SectionTitle>Multi-currency</SectionTitle>
        <Text variant="caption" color="muted">Local exchange rates. Convert amounts and set each account's currency.</Text>
        <TextField label="Amount" value={convertAmount} onChangeText={setConvertAmount} keyboardType="decimal-pad" />
        <Segmented value={convertFrom} onChange={setConvertFrom} options={rateList.map((r) => ({ value: r.code, label: r.code }))} />
        <Segmented value={convertTo} onChange={setConvertTo} options={rateList.map((r) => ({ value: r.code, label: r.code }))} />
        <Button label="Convert" icon="swap-horizontal" onPress={doConvert} />
        <View style={styles.chips}>
          {rateList.map((rate) => <Badge key={rate.code} label={`${rate.code}: ${rate.rate}`} />)}
        </View>
        <TextField label="Rate code" value={rateCode} onChangeText={setRateCode} />
        <TextField label="Rate (currency per EUR)" value={rateValue} onChangeText={setRateValue} keyboardType="decimal-pad" />
        <Button label="Save rate" tone="secondary" onPress={() => void saveRate()} />
        <View style={styles.chips}>
          {accountList.map((account) => (
            <Button key={account.id} label={`${account.name} · ${account.currency}`} tone="secondary" onPress={() => void setAccountCurrency(account.id, account.currency === "EUR" ? "USD" : "EUR").then(load)} />
          ))}
        </View>
      </Card>

      <Card>
        <SectionTitle>Credit / debit card settlement</SectionTitle>
        <Segmented value={cardId} onChange={setCardId} options={accountList.map((a) => ({ value: a.id, label: a.name }))} />
        {accountList.filter((a) => a.settlementDay > 0 || a.outstandingCents > 0).map((a) => (
          <View key={a.id} style={styles.row}>
            <Text style={styles.grow}>{a.name}</Text>
            <Text variant="caption" color="muted">{`settles day ${a.settlementDay}`}</Text>
            <Text color="muted">{core.formatEuro(a.outstandingCents)}</Text>
          </View>
        ))}
        <TextField label="Settlement day (1-28)" value={cardDay} onChangeText={setCardDay} keyboardType="number-pad" />
        <TextField label="Outstanding" value={cardOutstanding} onChangeText={setCardOutstanding} keyboardType="decimal-pad" />
        <Button label="Save card details" icon="card-account-details" onPress={() => void saveCard()} />
      </Card>

      <Card>
        <SectionTitle>Reports</SectionTitle>
        <Text variant="caption" color="muted">Excel-compatible CSV and a printable HTML report (save it as PDF from your browser).</Text>
        <Button label="Open reports" icon="file-chart" onPress={() => router.push("/reports")} />
        <Button label="Export CSV" icon="file-export" tone="secondary" onPress={() => router.push("/export")} />
        <Button label="Ask your money" icon="comment-question" tone="secondary" onPress={() => router.push("/ask")} />
        <Button label="Open finance suite" icon="view-dashboard" tone="secondary" onPress={() => router.push("/finance")} />
      </Card>

      <Card>
        <SectionTitle>Receipt entry</SectionTitle>
        <TextField label="Paste receipt lines" value={receiptText} onChangeText={setReceiptText} multiline placeholder={"Milk 1,29\nBread 2,50"} />
        <Button label="Add as expenses" icon="receipt" onPress={() => void importReceipt()} disabled={!receiptText.trim()} />
      </Card>

      <Card>
        <SectionTitle>Bill splitting</SectionTitle>
        <TextField label="Total amount" value={splitAmount} onChangeText={setSplitAmount} keyboardType="decimal-pad" />
        <TextField label="People" value={splitCount} onChangeText={setSplitCount} keyboardType="number-pad" />
        <Segmented value={splitMode} onChange={setSplitMode} options={[{ value: "equal", label: "Equal" }, { value: "amount", label: "By amount" }, { value: "percent", label: "Percent" }]} />
        {splitMode !== "equal" ? <TextField label="Shares, comma separated" value={splitShares} onChangeText={setSplitShares} placeholder="70, 30" /> : null}
        <Button label="Split bill" icon="call-split" onPress={doSplit} />
        {splitResult ? (
          <View style={styles.chips}>
            {splitResult.map((cents, index) => <Badge key={index} label={`#${index + 1}: ${core.formatEuro(cents)}`} tone="accent" />)}
          </View>
        ) : null}
      </Card>

      <Card>
        <SectionTitle>Debts</SectionTitle>
        <Text variant="number">{core.formatEuro(core.debtSummary(debtList).remaining)}</Text>
        <Text variant="caption" color="muted">left to pay</Text>
        {debtList.map((debt) => (
          <View key={debt.id} style={styles.row}>
            <View style={styles.grow}>
              <Text>{debt.name}</Text>
              <Text variant="caption" color="muted">{`${core.formatEuro(debt.paidCents)} / ${core.formatEuro(debt.totalCents)} · ${debt.dueDate}`}</Text>
            </View>
            <Button label="Pay 10" tone="secondary" onPress={() => void payDebt(debt.id, 1000).then(load)} />
            <IconButton icon="trash-can-outline" label={`Delete ${debt.name}`} onPress={() => void deleteDebt(debt.id).then(load)} />
          </View>
        ))}
        <TextField label="Debt name" value={debtName} onChangeText={setDebtName} />
        <TextField label="Total" value={debtTotal} onChangeText={setDebtTotal} keyboardType="decimal-pad" />
        <TextField label="Due date" value={debtDue} onChangeText={setDebtDue} placeholder="YYYY-MM-DD" />
        <Button label="Add debt" icon="plus" onPress={() => { const cents = parseEuro(debtTotal); if (cents !== null && debtName) void addDebt(debtName, cents, debtDue).then(() => { setDebtName(""); setDebtTotal(""); void load(); }); }} />
      </Card>

      <Card>
        <SectionTitle>Standing orders</SectionTitle>
        {orderList.map((order) => (
          <View key={order.id} style={styles.row}>
            <View style={styles.grow}>
              <Text>{order.name}</Text>
              <Text variant="caption" color="muted">{`day ${order.dayOfMonth} · ${core.formatEuro(order.amountCents)}`}</Text>
            </View>
            <IconButton icon="trash-can-outline" label={`Delete ${order.name}`} onPress={() => void deleteStandingOrder(order.id).then(load)} />
          </View>
        ))}
        <TextField label="Order name" value={orderName} onChangeText={setOrderName} />
        <TextField label="Amount" value={orderAmount} onChangeText={setOrderAmount} keyboardType="decimal-pad" />
        <TextField label="Day of month" value={orderDay} onChangeText={setOrderDay} keyboardType="number-pad" />
        <Button label="Add standing order" icon="plus" onPress={() => { const cents = parseEuro(orderAmount); if (cents !== null && orderName) void addStandingOrder(orderName, cents, Number(orderDay) || 1, "").then(() => { setOrderName(""); setOrderAmount(""); void load(); }); }} />
      </Card>

      <Card>
        <SectionTitle>Double-entry ledger</SectionTitle>
        <Badge label={core.ledgerCheck(ledger).balanced ? "BALANCED" : "CHECK FAILED"} tone={core.ledgerCheck(ledger).balanced ? "success" : "offer"} />
        {accountList.map((account) => (
          <View key={account.id} style={styles.row}>
            <Text style={styles.grow}>{account.name}</Text>
            <Text color="muted">{core.formatEuro(core.ledgerBalance(ledger, account.id))}</Text>
          </View>
        ))}
        <Text variant="caption" color="muted">Every transaction posts two equal entries: account ↔ expense/income category. Transfers post between two accounts.</Text>
      </Card>

      <Card>
        <SectionTitle>Savings goals</SectionTitle>
        {core.goalStatus(goalList).map((goal) => (
          <View key={goal.name} style={styles.row}>
            <View style={styles.grow}>
              <Text>{goal.name}</Text>
              <Text variant="caption" color="muted">{`${core.formatEuro(goal.saved)} / ${core.formatEuro(goal.target)} · ${goal.percent}% · ${goal.daysLeft} days left`}</Text>
            </View>
            <Button label="Add 10" tone="secondary" onPress={() => void contributeGoal(goalList.find((g) => g.name === goal.name)!.id, 1000).then(load)} />
            <IconButton icon="trash-can-outline" label={`Delete ${goal.name}`} onPress={() => void deleteGoal(goalList.find((g) => g.name === goal.name)!.id).then(load)} />
          </View>
        ))}
        <TextField label="Goal name" value={goalName} onChangeText={setGoalName} />
        <TextField label="Target" value={goalTarget} onChangeText={setGoalTarget} keyboardType="decimal-pad" />
        <TextField label="Target date" value={goalDue} onChangeText={setGoalDue} placeholder="YYYY-MM-DD" />
        <Button label="Add goal" icon="plus" onPress={() => { const cents = parseEuro(goalTarget); if (cents !== null && goalName) void addGoal(goalName, cents, goalDue).then(() => { setGoalName(""); setGoalTarget(""); void load(); }); }} />
      </Card>

      <Card>
        <SectionTitle>Subcategories</SectionTitle>
        <View style={styles.chips}>
          {categoryList.map((category) => <Badge key={category.id} label={`${category.parent} › ${category.name}`} />)}
        </View>
        <TextField label="New subcategory" value={catName} onChangeText={setCatName} />
        <TextField label="Parent category" value={catParent} onChangeText={setCatParent} />
        <Button label="Add subcategory" icon="plus" onPress={() => { if (catName && catParent) void addCategory(catName, catParent).then(() => { setCatName(""); void load(); }); }} />
        <Button label="Roll up spending by parent" icon="chart-tree" tone="secondary" onPress={() => setMessage(core.groupCategories(tagRows, categoryList, "").map((c) => `${c.category}: ${core.formatEuro(c.cents)}`).join(" · "))} />
      </Card>

      <Card>
        <SectionTitle>Tags &amp; places</SectionTitle>
        <TextField label="Filter by hashtag" value={tagFilter} onChangeText={setTagFilter} placeholder="office, holiday…" />
        <Button label="Filter transactions" icon="magnify" onPress={() => setMessage(`${core.filterTag(tagRows, tagFilter).length} transactions tagged "${tagFilter}"`)} />
        <Text variant="caption" color="muted">Where coordinates were added, places are grouped into 0.1° areas.</Text>
        <View style={styles.chips}>
          {core.geoSummary(tagRows).map((place, index) => <Badge key={index} label={`${place.latitude}, ${place.longitude} · ${place.visits} visits · ${core.formatEuro(place.total)}`} />)}
        </View>
      </Card>

      <Card>
        <SectionTitle>Receipts &amp; warranty</SectionTitle>
        {core.warrantyStatus(receiptList).map((receipt, index) => (
          <View key={index} style={styles.row}>
            <View style={styles.grow}>
              <Text>{receipt.name}</Text>
              <Text variant="caption" color="muted">{`${core.formatEuro(receipt.amountCents)} · until ${receipt.warrantyUntil} · ${receipt.expired ? "expired" : `${receipt.daysLeft} days`}`}</Text>
            </View>
            <IconButton icon="trash-can-outline" label={`Delete ${receipt.name}`} onPress={() => void deleteReceipt(receiptList[index].id).then(load)} />
          </View>
        ))}
        <TextField label="Shop" value={receiptMerchant} onChangeText={setReceiptMerchant} />
        <TextField label="Amount" value={receiptAmount} onChangeText={setReceiptAmount} keyboardType="decimal-pad" />
        <TextField label="Warranty until" value={receiptWarranty} onChangeText={setReceiptWarranty} placeholder="YYYY-MM-DD" />
        <TextField label="Tags" value={receiptTags} onChangeText={setReceiptTags} placeholder="gift, electronics" />
        <Button label="Save receipt" icon="receipt" onPress={() => { const cents = parseEuro(receiptAmount); if (cents !== null && receiptMerchant) void addReceipt({ merchant: receiptMerchant, date: new Date().toISOString().slice(0, 10), amountCents: cents, warrantyUntil: receiptWarranty, note: "", tags: receiptTags }).then(() => { setReceiptMerchant(""); setReceiptAmount(""); void load(); }); }} />
      </Card>

      <Card>
        <SectionTitle>PC editing</SectionTitle>
        <Text variant="caption" color="muted">On a laptop, open this app's web build at the same LAN address to edit transactions in a full table.</Text>
        <Button label="Open PC editor" icon="laptop" tone="secondary" onPress={() => router.push("/pc")} />
      </Card>

      <Card>
        <SectionTitle>Two-device shared view</SectionTitle>
        <Text variant="caption" color="muted">Load a backup exported from a second device. Your records stay separate; combined totals are computed locally.</Text>
        <Button label="Load partner backup" icon="account-multiple" tone="secondary" onPress={() => void pickPartnerBackup()} />
        {(() => {
          const combined = core.combinedSummary(tagRows, partnerRows);
          return (
            <View style={styles.chips}>
              <Badge label={`Your spend ${core.formatEuro(combined.ownExpense)}`} />
              <Badge label={`Partner spend ${core.formatEuro(combined.partnerExpense)}`} />
              <Badge label={`Combined ${core.formatEuro(combined.totalExpense)}`} tone="accent" />
              <Badge label={`Combined income ${core.formatEuro(combined.totalIncome)}`} />
            </View>
          );
        })()}
        <Button label="Clear partner view" icon="close" tone="secondary" onPress={() => void clearSharedSnapshot().then(load)} disabled={!partnerRows.length} />
      </Card>

      <Card>
        <SectionTitle>Local backup &amp; sharing</SectionTitle>
        <Text variant="caption" color="muted">Export one JSON file to move your data to another device — no cloud account needed.</Text>
        <Button label="Create backup" icon="download" onPress={() => void exportBackup().then(setBackupJson)} />
        <Button label="Share backup to another device" icon="share-variant" tone="secondary" onPress={() => void shareBackup()} />
        <Button label="Pick backup file from device" icon="file-import" tone="secondary" onPress={() => void pickBackup()} />
        {backupJson ? <TextField label="Backup (copy this)" value={backupJson} onChangeText={setBackupJson} multiline /> : null}
        <TextField label="Paste backup to restore" value={importJson} onChangeText={setImportJson} multiline />
        <Button label="Import backup" icon="upload" onPress={() => void importBackup(importJson).then(() => { setMessage("Backup imported."); void load(); }).catch((e) => setMessage(e instanceof Error ? e.message : "Import failed"))} disabled={!importJson.trim()} />
      </Card>

      <Card>
        <SectionTitle>Due soon</SectionTitle>
        {reminders.length ? reminders.map((reminder, index) => (
          <View key={`${reminder.name}-${index}`} style={styles.row}>
            <Text style={styles.grow}>{reminder.name}</Text>
            <Text variant="caption" color="muted">{reminder.nextDate}</Text>
            <Text color="muted">{core.formatEuro(reminder.amountCents)}</Text>
          </View>
        )) : <Empty title="Nothing due" message="No scheduled payments in the next 7 days." />}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: tokens.sm },
  row: { flexDirection: "row", alignItems: "center", gap: tokens.sm },
  grow: { flex: 1 },
});
