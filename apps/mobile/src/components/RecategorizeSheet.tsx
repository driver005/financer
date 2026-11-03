import { useEffect, useState } from "react";
import { Box, Button, Note, Sheet, Switch, Text } from "@financer/ui";

import type { Split, Transaction } from "@/api/client";
import { useApi } from "@/api/config";
import { CategoryPicker } from "@/components/CategoryPicker";
import { SplitEditor } from "@/components/SplitEditor";
import { formatCents, formatDate } from "@/format";

/**
 * Opens for the tapped transaction: pick another category (optionally remembering it for the
 * merchant, which creates a rule) or split it into parts. `onChanged` gets a short message
 * for the list screen, which should reload.
 */
export function RecategorizeSheet({ tx, split, onClose, onChanged }: { tx: Transaction | null; split?: Split; onClose: () => void; onChanged: (note: string) => void }) {
  const { api } = useApi();
  const [category, setCategory] = useState("other");
  const [remember, setRemember] = useState(false);
  const [splitting, setSplitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setCategory(tx?.category ?? "other");
    setRemember(false);
    setSplitting(false);
    setError(null);
  }, [tx]);

  async function save() {
    if (!api || !tx) return;
    setBusy(true);
    try {
      const r = await api.setCategory(tx.id, category, remember);
      const rest = r.others_changed > 0 ? `, ${r.others_changed} other transaction${r.others_changed === 1 ? "" : "s"} changed` : "";
      onChanged(r.rule ? `Saved as ${category}; rule for "${r.rule.pattern}" kept${rest}` : `Saved as ${category}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not change the category");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet visible={tx !== null} onClose={onClose} title={tx ? tx.counterparty || "Unknown" : undefined}>
      {tx ? (
        <Box gap="md">
          <Text variant="label" tone="muted">{`${formatDate(tx.booking_date)} · ${formatCents(tx.amount_cents)}${split ? " · split" : ""}`}</Text>
          {splitting ? (
            <SplitEditor tx={tx} existing={split} onDone={onChanged} onCancel={() => setSplitting(false)} />
          ) : (
            <>
              <Text variant="subheading">Category</Text>
              {split ? <Text variant="caption" tone="muted">This transaction is split, so its parts decide the totals. This sets the category shown for the whole booking.</Text> : null}
              <CategoryPicker value={category} onChange={setCategory} />
              <Box direction="row" align="center" justify="between" gap="md">
                <Box grow>
                  <Text variant="bodyStrong">Remember for this merchant</Text>
                  <Text variant="caption" tone="muted">Adds a rule so its other and future transactions follow.</Text>
                </Box>
                <Switch value={remember} onChange={setRemember} label="Remember for this merchant" />
              </Box>
              {error ? <Note tone="error">{error}</Note> : null}
              <Button label="Save category" icon="check" onPress={save} disabled={busy || (category === (tx.category ?? "") && !remember)} />
              <Button label={split ? "Edit split" : "Split this transaction"} icon="call-split" variant="outline" onPress={() => setSplitting(true)} disabled={busy} />
              <Button label="Close" variant="ghost" onPress={onClose} />
            </>
          )}
        </Box>
      ) : null}
    </Sheet>
  );
}
