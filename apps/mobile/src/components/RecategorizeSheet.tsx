import { useEffect, useState } from "react";
import { Modal, ScrollView, View } from "react-native";

import type { Split, Transaction } from "@/api/client";
import { useApi } from "@/api/config";
import { CategoryPicker } from "@/components/CategoryPicker";
import { SplitEditor } from "@/components/SplitEditor";
import { HelperText, Switch, Text } from "@/components/kit";
import { Body, Button, Page, useColors } from "@/components/ui";
import { formatCents, formatDate } from "@/format";

/**
 * Opens for the tapped transaction: pick another category (optionally remembering it for the
 * merchant, which creates a rule) or split it into parts. `onChanged` gets a short message
 * for the list screen, which should reload.
 */
export function RecategorizeSheet({
  tx,
  split,
  onClose,
  onChanged,
}: {
  tx: Transaction | null;
  split?: Split;
  onClose: () => void;
  onChanged: (note: string) => void;
}) {
  const { api } = useApi();
  const c = useColors();
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
    <Modal visible={tx !== null} animationType="slide" onRequestClose={onClose}>
      <Page edges={["top", "left", "right", "bottom"]}>
        {tx ? (
          <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Text variant="headlineSmall" accessibilityRole="header">
              {tx.counterparty || "Unknown"}
            </Text>
            <Text variant="bodyMedium" style={{ color: c.muted, marginTop: 2 }}>
              {formatDate(tx.booking_date)} · {formatCents(tx.amount_cents)}
              {split ? " · split" : ""}
            </Text>

            {splitting ? (
              <View style={{ marginTop: 20 }}>
                <SplitEditor
                  tx={tx}
                  existing={split}
                  onDone={onChanged}
                  onCancel={() => setSplitting(false)}
                />
              </View>
            ) : (
              <View style={{ marginTop: 20 }}>
                <Text variant="titleMedium">Category</Text>
                {split ? (
                  <Text variant="bodySmall" style={{ color: c.muted, marginTop: 2 }}>
                    This transaction is split, so its parts decide the totals. This sets the category shown for the whole booking.
                  </Text>
                ) : null}
                <View style={{ marginTop: 10 }}>
                  <CategoryPicker value={category} onChange={setCategory} />
                </View>
                <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 16, gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Body bold>Remember for this merchant</Body>
                    <Text variant="bodySmall" style={{ color: c.muted }}>
                      Adds a rule so its other and future transactions follow.
                    </Text>
                  </View>
                  <Switch value={remember} onValueChange={setRemember} accessibilityLabel="Remember for this merchant" />
                </View>
                <HelperText type="error" visible={!!error}>
                  {error}
                </HelperText>
                <View style={{ marginTop: 16, gap: 8 }}>
                  <Button label="Save category" icon="check" onPress={save} disabled={busy || (category === (tx.category ?? "") && !remember)} />
                  <Button label={split ? "Edit split" : "Split this transaction"} icon="call-split" mode="outlined" onPress={() => setSplitting(true)} disabled={busy} />
                </View>
              </View>
            )}
            {splitting ? null : (
              <View style={{ marginTop: 8 }}>
                <Button label="Close" mode="text" onPress={onClose} />
              </View>
            )}
          </ScrollView>
        ) : null}
      </Page>
    </Modal>
  );
}
