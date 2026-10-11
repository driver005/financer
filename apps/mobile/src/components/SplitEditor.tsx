import { useState } from "react";
import { View } from "react-native";

import type { Split, Transaction } from "@/api/client";
import { useApi } from "@/api/config";
import { CategoryPicker } from "@/components/CategoryPicker";
import { HelperText, IconButton, Text, TextInput } from "@/components/kit";
import { Button, useColors } from "@/components/ui";
import { formatCents } from "@/format";
import { draftFromSplit, initialSplit, splitFromDraft, splitRemainder, type SplitDraftPart } from "@/rules";

/**
 * Divide one transaction into parts with their own category. The parts must add up to the
 * booked amount; the server checks it again.
 */
export function SplitEditor({
  tx,
  existing,
  onDone,
  onCancel,
}: {
  tx: Transaction;
  existing?: Split;
  /** Called after the split was saved or removed, with a short message for the list screen. */
  onDone: (note: string) => void;
  onCancel: () => void;
}) {
  const { api } = useApi();
  const c = useColors();
  const [parts, setParts] = useState<SplitDraftPart[]>(() =>
    existing ? draftFromSplit(existing.parts) : initialSplit(tx.amount_cents, tx.category),
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = splitRemainder(tx.amount_cents, parts);

  const patch = (i: number, change: Partial<SplitDraftPart>) =>
    setParts((p) => p.map((x, j) => (j === i ? { ...x, ...change } : x)));

  const addPart = () =>
    setParts((p) => [...p, { amount: left > 0 ? (left / 100).toFixed(2).replace(".", ",") : "", category: "other", note: "" }]);

  async function save() {
    if (!api) return;
    const built = splitFromDraft(tx.amount_cents, parts);
    if ("error" in built) {
      setError(built.error);
      return;
    }
    setBusy(true);
    try {
      await api.putSplit(tx.id, { parts: built.parts });
      onDone(`Split into ${built.parts.length} parts`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the split");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!api) return;
    setBusy(true);
    try {
      await api.deleteSplit(tx.id);
      onDone("Split removed");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove the split");
    } finally {
      setBusy(false);
    }
  }

  return (
    <View>
      <Text variant="titleMedium">Split {formatCents(tx.amount_cents)}</Text>
      <Text variant="bodySmall" style={{ color: c.muted, marginTop: 2 }}>
        Budget and spending totals use the parts instead of the whole amount.
      </Text>
      {parts.map((p, i) => (
        <View key={i} style={{ marginTop: 14 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <TextInput
              mode="outlined"
              dense
              value={p.amount}
              onChangeText={(t) => patch(i, { amount: t })}
              placeholder="0,00"
              keyboardType="decimal-pad"
              right={<TextInput.Affix text="€" />}
              style={{ width: 130 }}
              accessibilityLabel={`Amount of part ${i + 1} in euro`}
            />
            <TextInput
              mode="outlined"
              dense
              value={p.note}
              onChangeText={(t) => patch(i, { note: t })}
              placeholder="Note (optional)"
              maxLength={200}
              style={{ flex: 1 }}
              accessibilityLabel={`Note for part ${i + 1}`}
            />
            {parts.length > 2 ? (
              <IconButton icon="close" accessibilityLabel={`Remove part ${i + 1}`} onPress={() => setParts((x) => x.filter((_, j) => j !== i))} />
            ) : null}
          </View>
          <View style={{ marginTop: 8 }}>
            <CategoryPicker horizontal value={p.category} onChange={(category) => patch(i, { category })} />
          </View>
        </View>
      ))}
      <Text variant="bodyMedium" style={{ color: left === 0 ? c.good : c.bad, marginTop: 12 }}>
        {left === 0 ? "Adds up exactly" : left > 0 ? `${formatCents(left)} still to assign` : `${formatCents(-left)} too much`}
      </Text>
      <HelperText type="error" visible={!!error}>
        {error}
      </HelperText>
      <View style={{ marginTop: 12, gap: 8 }}>
        <Button label="Save split" icon="content-save-outline" onPress={save} disabled={busy} />
        <Button label="Add a part" icon="plus" mode="outlined" onPress={addPart} disabled={busy} />
        {existing ? <Button label="Remove split" icon="delete-outline" mode="outlined" onPress={remove} disabled={busy} /> : null}
        <Button label="Back" mode="text" onPress={onCancel} disabled={busy} />
      </View>
    </View>
  );
}
