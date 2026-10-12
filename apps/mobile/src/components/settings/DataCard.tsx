import { useState } from "react";
import { View } from "react-native";

import type { ExportData } from "@/api/client";
import { useApi } from "@/api/config";
import { FieldMessage, PanelText, SettingsPanel } from "@/components/settings/SettingsKit";
import { Button } from "@/components/ui";
import { pickTextFile, shareTextFile } from "@/native/files";

/** Settings, Account & data: the plain JSON export and import (the encrypted backup is its own card). */
export function DataCard() {
  const { api } = useApi();
  const [status, setStatus] = useState<{ text: string; ok: boolean } | null>(null);
  if (!api) return null;

  async function exportBackup() {
    if (!api) return;
    try {
      const data = await api.exportData();
      const stamp = new Date().toISOString().slice(0, 10);
      await shareTextFile(`financer-backup-${stamp}.json`, JSON.stringify(data), "application/json");
      setStatus({ text: `Exported ${data.transactions.length} transactions, ${data.receipts.length} receipts.`, ok: true });
    } catch (e) {
      setStatus({ text: e instanceof Error ? e.message : "Export failed", ok: false });
    }
  }

  async function importBackup() {
    if (!api) return;
    try {
      const text = await pickTextFile(["application/json", "text/plain"]);
      if (text === null) return;
      const r = await api.importData(JSON.parse(text) as ExportData);
      setStatus({
        text: `Imported ${r.transactions_added} new transactions (${r.transactions_known} already here) and ${r.receipts_added} receipts.`,
        ok: true,
      });
    } catch (e) {
      setStatus({ text: e instanceof SyntaxError ? "That file is not a Financer backup." : e instanceof Error ? e.message : "Import failed", ok: false });
    }
  }

  return (
    <SettingsPanel icon="swap-vertical-bold" title="Export and import" summary="Move your data as a plain file">
      <PanelText style={{ marginTop: 4 }}>
        A backup file holds your transactions, budget, usual items and receipts, never PINs, tokens or API keys. Use it to back up, or to move between a server and this phone. Importing twice changes nothing.
      </PanelText>
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Button label="Export" icon="export" onPress={exportBackup} />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Import" icon="import" mode="outlined" onPress={importBackup} />
        </View>
      </View>
      {status ? <FieldMessage tone={status.ok ? "ok" : "error"}>{status.text}</FieldMessage> : null}
    </SettingsPanel>
  );
}
