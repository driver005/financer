import React, { useEffect, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import { Button, Card, IconButton, Note, Screen, SectionTitle, Segmented, Text, TextField } from "../ui/primitives";
import { tokens } from "../ui/theme";
import { accounts, addBookmark, addMoneyTransaction, bookmarks, type Account, type Bookmark } from "../db/moneyTracker";
import { core } from "../rust/core";
import { parseEuro } from "../lib/money";
import type { Store } from "../lib/types";

const CATEGORIES = ["Groceries", "Rent", "Transport", "Utilities", "Health", "Leisure", "Shopping", "Salary", "Other"];

export default function QuickAddScreen() {
  const router = useRouter();
  const [kind, setKind] = useState<"expense" | "income">("expense");
  const [amount, setAmount] = useState("");
  const [expression, setExpression] = useState("");
  const [merchant, setMerchant] = useState("");
  const [category, setCategory] = useState("Groceries");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [tags, setTags] = useState("");
  const [subcategory, setSubcategory] = useState("");
  const [accountList, setAccountList] = useState<Account[]>([]);
  const [accountId, setAccountId] = useState("bank");
  const [savedBookmarks, setSavedBookmarks] = useState<Bookmark[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);

  useEffect(() => {
    void accounts().then((rows) => { setAccountList(rows); setAccountId(rows[0]?.id ?? "bank"); });
    void bookmarks().then(setSavedBookmarks);
    const scope = globalThis as unknown as { SpeechRecognition?: new () => Record<string, unknown>; webkitSpeechRecognition?: new () => Record<string, unknown> };
    setVoiceSupported(Platform.OS === "web" && !!(scope.SpeechRecognition || scope.webkitSpeechRecognition));
  }, []);

  const dictate = () => {
    const scope = globalThis as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any };
    const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
    if (!Recognition) { setMessage("Dictation is only available in a browser here. Type the merchant instead."); return; }
    const recognition = new Recognition();
    recognition.lang = "de-DE";
    recognition.interimResults = false;
    recognition.onresult = (event: { results: { 0: { 0: { transcript: string } } } }) => {
      const spoken = event.results[0][0].transcript;
      setMerchant(spoken);
      const match = spoken.match(/(\d+[.,]\d{1,2})/);
      if (match) setAmount(match[1].replace(".", ","));
      setListening(false);
    };
    recognition.onerror = () => { setMessage("Could not hear you. Try again or type."); setListening(false); };
    recognition.onend = () => setListening(false);
    recognition.start();
    setListening(true);
  };

  const applyBookmark = (bookmark: Bookmark) => {
    setMerchant(bookmark.name);
    setAmount(String(bookmark.amountCents / 100).replace(".", ","));
    setCategory(bookmark.category);
  };

  const calculate = () => {
    const cents = core.evaluate(expression);
    if (cents === null) { setMessage("Use numbers and + - * /, e.g. 12,50 + 2*3"); return; }
    setAmount(String(cents / 100).replace(".", ","));
    setExpression("");
    setMessage(null);
  };

  const save = async () => {
    const cents = parseEuro(amount);
    if (cents === null || cents <= 0) { setMessage("Enter an amount like 4,50."); return; }
    await addMoneyTransaction({ date, merchant: merchant.trim() || category, amountCents: cents, category: subcategory ? `${category} / ${subcategory}` : category, kind, accountId, tags });
    router.back();
  };

  return (
    <Screen
      title="Add transaction"
      subtitle="One amount, one category, done"
      back={<IconButton icon="arrow-left" label="Back" onPress={() => router.back()} />}
    >
      <Segmented value={kind} onChange={setKind} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }]} />

      <Card>
        <SectionTitle>Amount</SectionTitle>
        <TextField label="Amount in €" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
        <TextField label="Calculator (optional)" value={expression} onChangeText={setExpression} keyboardType="decimal-pad" placeholder="12,50 + 2*3" />
        <Button label="Calculate" icon="sigma" tone="secondary" onPress={calculate} disabled={!expression.trim()} />
      </Card>

      <Card>
        <SectionTitle>Category</SectionTitle>
        <View style={styles.chips}>
          {CATEGORIES.map((item) => (
            <Button key={`btn-${item}`} label={item} tone={category === item ? "accent" : "secondary"} onPress={() => setCategory(item)} />
          ))}
        </View>
      </Card>

      <Card>
        <SectionTitle>Details</SectionTitle>
        <TextField label="Merchant" value={merchant} onChangeText={setMerchant} placeholder="e.g. REWE" />
        <Button label={listening ? "Listening…" : "Dictate merchant"} icon="microphone" tone="secondary" onPress={dictate} disabled={listening || !voiceSupported} />
        {!voiceSupported ? <Text variant="caption" color="muted">Voice entry uses your browser's dictation; on a phone, type the merchant.</Text> : null}
        <TextField label="Subcategory" value={subcategory} onChangeText={setSubcategory} placeholder="e.g. Coffee" />
        <TextField label="Hashtags" value={tags} onChangeText={setTags} placeholder="office, holiday" />
        <TextField label="Date" value={date} onChangeText={setDate} placeholder="YYYY-MM-DD" />
        <Text variant="caption" color="muted">Account</Text>
        <View style={styles.chips}>
          {accountList.map((account) => (
            <Button key={account.id} label={account.name} tone={accountId === account.id ? "accent" : "secondary"} onPress={() => setAccountId(account.id)} />
          ))}
        </View>
      </Card>

      {savedBookmarks.length ? (
        <Card>
          <SectionTitle>Frequent</SectionTitle>
          <View style={styles.chips}>
            {savedBookmarks.map((bookmark) => (
              <Button key={bookmark.id} label={`${bookmark.name} · ${core.formatEuro(bookmark.amountCents)}`} tone="secondary" onPress={() => applyBookmark(bookmark)} />
            ))}
          </View>
        </Card>
      ) : null}

      {message ? <Note tone="error">{message}</Note> : null}
      <Button label="Save transaction" icon="check" onPress={() => void save()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: "row", flexWrap: "wrap", gap: tokens.sm },
});
