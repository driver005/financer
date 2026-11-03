import { useRouter } from "expo-router";
import { useState } from "react";
import { Box, Button, Card, Group, ListItem, Note, Row, Switch, Text } from "@financer/ui";

import type { Suggestions } from "@/api/client";
import { useApi } from "@/api/config";
import { categoryLabel } from "@/categoryIcons";

/**
 * Spending-screen tools: a link to the rules, and "Suggest categories", which asks the
 * configured AI about merchants still left as uncategorized/other. Only their names are sent.
 * Accepting suggestions creates rules; `onChanged` lets the list reload.
 */
export function CategorizationTools({ onChanged }: { onChanged: (note: string) => void }) {
  const { api } = useApi();
  const router = useRouter();
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
    <Box gap="md">
      <Group>
        <ListItem icon="format-list-bulleted" tile title="Categorization rules" subtitle="Decide where merchants go" onPress={() => router.push("/rules")} />
        <ListItem icon="auto-fix" tile title="Suggest categories" subtitle="AI help for unknown merchants" onPress={busy ? undefined : () => void suggest()} />
      </Group>
      {message ? <Note>{message}</Note> : null}
      {result && result.suggestions.length > 0 ? (
        <Card gap="md">
          {result.suggestions.map((s) => (
            <Row key={s.merchant} gap="md">
              <Box grow>
                <Text variant="bodyStrong">{s.merchant}</Text>
                <Text variant="caption" tone="muted">{`${categoryLabel(s.category)} · ${s.transactions} transaction${s.transactions === 1 ? "" : "s"}`}</Text>
              </Box>
              <Switch value={!!chosen[s.merchant]} onChange={(v) => setChosen((x) => ({ ...x, [s.merchant]: v }))} label={`Accept ${s.category} for ${s.merchant}`} />
            </Row>
          ))}
          <Button label={`Create ${count} rule${count === 1 ? "" : "s"}`} icon="check" onPress={() => void accept()} disabled={busy || count === 0} />
        </Card>
      ) : null}
    </Box>
  );
}
