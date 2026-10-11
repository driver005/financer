import { Link } from "expo-router";
import { useState } from "react";
import { View } from "react-native";

import type { Suggestions } from "@/api/client";
import { useApi } from "@/api/config";
import { Switch, Text } from "@/components/kit";
import { Body, Button, Card, useColors } from "@/components/ui";

/**
 * Spending-screen card: a link to the rules, and "Suggest categories", which asks the
 * configured AI about merchants still left as uncategorized/other. Only their names are sent.
 * Accepting suggestions creates rules; `onChanged` lets the list reload.
 */
export function CategorizationTools({ onChanged }: { onChanged: (note: string) => void }) {
  const { api } = useApi();
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Suggestions | null>(null);
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  const [message, setMessage] = useState<string | null>(null);

  async function suggest() {
    if (!api) return;
    setBusy(true);
    setMessage("Asking your AI provider… (only merchant names are sent)");
    try {
      const r = await api.suggestCategories();
      setResult(r);
      setChosen(Object.fromEntries(r.suggestions.map((s) => [s.merchant, true])));
      setMessage(
        r.merchants_sent === 0
          ? "Every merchant already has a category."
          : r.suggestions.length === 0
            ? "The AI had no confident suggestion."
            : null,
      );
    } catch (e) {
      setResult(null);
      setMessage(e instanceof Error ? e.message : "Could not get suggestions");
    } finally {
      setBusy(false);
    }
  }

  async function accept() {
    if (!api || !result) return;
    const picked = result.suggestions.filter((s) => chosen[s.merchant]).map((s) => ({ merchant: s.merchant, category: s.category }));
    if (picked.length === 0) return;
    setBusy(true);
    try {
      const r = await api.acceptSuggestions(picked);
      setResult(null);
      setMessage(null);
      onChanged(`Saved ${r.rules_saved} rule${r.rules_saved === 1 ? "" : "s"}, ${r.transactions_changed} transaction${r.transactions_changed === 1 ? "" : "s"} changed`);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not save the rules");
    } finally {
      setBusy(false);
    }
  }

  const count = result ? result.suggestions.filter((s) => chosen[s.merchant]).length : 0;

  return (
    <Card>
      <View style={{ gap: 8 }}>
        <Link href="/rules" asChild>
          <Button label="Categorization rules" icon="format-list-bulleted" mode="outlined" onPress={() => {}} />
        </Link>
        <Button label="Suggest categories" icon="auto-fix" mode="outlined" onPress={suggest} disabled={busy} />
      </View>
      {message ? <Text variant="bodySmall" style={{ color: c.muted, marginTop: 8 }}>{message}</Text> : null}
      {result && result.suggestions.length > 0 ? (
        <View style={{ marginTop: 8 }}>
          {result.suggestions.map((s) => (
            <View key={s.merchant} style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 }}>
              <View style={{ flex: 1 }}>
                <Body bold>{s.merchant}</Body>
                <Text variant="bodySmall" style={{ color: c.muted }}>
                  {s.category} · {s.transactions} transaction{s.transactions === 1 ? "" : "s"}
                </Text>
              </View>
              <Switch
                value={!!chosen[s.merchant]}
                onValueChange={(v) => setChosen((x) => ({ ...x, [s.merchant]: v }))}
                accessibilityLabel={`Accept ${s.category} for ${s.merchant}`}
              />
            </View>
          ))}
          <View style={{ marginTop: 12 }}>
            <Button label={`Create ${count} rule${count === 1 ? "" : "s"}`} icon="check" onPress={accept} disabled={busy || count === 0} />
          </View>
        </View>
      ) : null}
    </Card>
  );
}
