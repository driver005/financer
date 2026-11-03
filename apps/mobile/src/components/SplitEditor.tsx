import { useState } from "react";
import { Box, Button, IconButton, Note, Row, Text, TextField } from "@financer/ui";

import type { Split, Transaction } from "@/api/client";
import { useApi } from "@/api/config";
import { CategoryPicker } from "@/components/CategoryPicker";
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
  const [parts, setParts] = useState<SplitDraftPart[]>(() => (existing ? draftFromSplit(existing.parts) : initialSplit(tx.amount_cents, tx.category)));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const left = splitRemainder(tx.amount_cents, parts);

  const patch = (i: number, change: Partial<SplitDraftPart>) => setParts((p) => p.map((x, j) => (j === i ? { ...x, ...change } : x)));

  const addPart = () => setParts((p) => [...p, { amount: left > 0 ? (left / 100).toFixed(2).replace(".", ",") : "", category: "other", note: "" }]);

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
    <Box gap="md">
      <Box gap="2xs">
        <Text variant="subheading">{`Split ${formatCents(tx.amount_cents)}`}</Text>
        <Text variant="caption" tone="muted">Budget and spending totals use the parts instead of the whole amount.</Text>
      </Box>
      {parts.map((p, i) => (
        <Box key={i} gap="sm">
          <Row gap="sm" align="end">
            <Box basis="half">
              <TextField label={`Part ${i + 1}`} value={p.amount} onChangeText={(t) => patch(i, { amount: t })} placeholder="0,00" keyboardType="decimal-pad" right={<Text variant="label" tone="muted">€</Text>} />
            </Box>
            <Box grow>
              <TextField label="Note" value={p.note} onChangeText={(t) => patch(i, { note: t })} placeholder="Optional" maxLength={200} />
            </Box>
            {parts.length > 2 ? <IconButton icon="close" label={`Remove part ${i + 1}`} onPress={() => setParts((x) => x.filter((_, j) => j !== i))} /> : null}
          </Row>
          <CategoryPicker value={p.category} onChange={(category) => patch(i, { category })} />
        </Box>
      ))}
      <Text variant="label" tone={left === 0 ? "success" : "danger"}>{left === 0 ? "Adds up exactly" : left > 0 ? `${formatCents(left)} still to assign` : `${formatCents(-left)} too much`}</Text>
      {error ? <Note tone="error">{error}</Note> : null}
      <Button label="Save split" icon="content-save-outline" onPress={save} disabled={busy} />
      <Button label="Add a part" icon="plus" variant="outline" onPress={addPart} disabled={busy} />
      {existing ? <Button label="Remove split" icon="delete-outline" variant="outline" tone="danger" onPress={remove} disabled={busy} /> : null}
      <Button label="Back" variant="ghost" onPress={onCancel} disabled={busy} />
    </Box>
  );
}
