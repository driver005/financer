import { useRouter } from "expo-router";
import { useState } from "react";
import { Text as RNText, View } from "react-native";

import type { Suggestions } from "@/api/client";
import { useApi } from "@/api/config";
import { ChunkyButton, Switch } from "@/components/kit";
import { ListGroup, ListRow } from "@/components/rows";
import { Card } from "@/components/ui";
import { categoryLabel } from "@/categoryIcons";
import { space, typography, usePalette } from "@/theme";

/**
 * Spending-screen tools: a link to the rules, and "Suggest categories", which asks the
 * configured AI about merchants still left as uncategorized/other. Only their names are sent.
 * Accepting suggestions creates rules; `onChanged` lets the list reload.
 */
export function CategorizationTools({ onChanged }: { onChanged: (note: string) => void }) {
  const { api } = useApi();
  const router = useRouter();
  const p = usePalette();
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
    <>
      <ListGroup>
        <ListRow icon="format-list-bulleted" title="Categorization rules" subtitle="Decide where merchants go" onPress={() => router.push("/rules")} />
        <ListRow
          icon="auto-fix"
          iconTone="gold"
          title="Suggest categories"
          subtitle="AI help for unknown merchants"
          onPress={busy ? undefined : () => void suggest()}
          accessibilityHint={busy ? "Working" : undefined}
        />
      </ListGroup>
      {message ? <RNText style={[typography.caption, { color: p.muted, marginBottom: space.md, paddingHorizontal: space.xs }]}>{message}</RNText> : null}
      {result && result.suggestions.length > 0 ? (
        <Card>
          {result.suggestions.map((s, i) => (
            <View key={s.merchant} style={{ flexDirection: "row", alignItems: "center", gap: space.md, marginTop: i === 0 ? 0 : space.md }}>
              <View style={{ flex: 1, minWidth: 0 }}>
                <RNText style={[typography.bodyStrong, { color: p.text }]}>{s.merchant}</RNText>
                <RNText style={[typography.caption, { color: p.muted }]}>
                  {categoryLabel(s.category)} · {s.transactions} transaction{s.transactions === 1 ? "" : "s"}
                </RNText>
              </View>
              <Switch
                value={!!chosen[s.merchant]}
                onValueChange={(v) => setChosen((x) => ({ ...x, [s.merchant]: v }))}
                accessibilityLabel={`Accept ${s.category} for ${s.merchant}`}
              />
            </View>
          ))}
          <View style={{ marginTop: space.lg }}>
            <ChunkyButton label={`Create ${count} rule${count === 1 ? "" : "s"}`} icon="check" onPress={() => void accept()} disabled={busy || count === 0} />
          </View>
        </Card>
      ) : null}
    </>
  );
}
