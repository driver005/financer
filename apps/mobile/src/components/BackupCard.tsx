import { useCallback, useEffect, useState } from "react";
import { Platform, View } from "react-native";

import { useApi } from "@/api/config";
import { manualBackupName, passphraseProblem, type BackupSchedule, type BackupSettings } from "@/backupPlan";
import { HelperText, SegmentedButtons, Text, TextInput } from "@/components/kit";
import { Button, Card, useColors } from "@/components/ui";
import {
  canKeepBackupsOnDevice,
  canPickBackupFolder,
  chooseBackupFolder,
  forgetPassphrase,
  keepBackup,
  lastAutoBackupTime,
  loadBackupSettings,
  loadSavedPassphrase,
  pickBackupFile,
  runAutoBackupIfDue,
  savePassphrase,
  saveBackupSettings,
  shareBackup,
} from "@/native/backup";

const isWeb = Platform.OS === "web";

function describeError(e: unknown, fallback: string): string {
  return e instanceof Error ? e.message : fallback;
}

/** Settings card: encrypted backups, made by hand or automatically. */
export function BackupCard() {
  const { api } = useApi();
  const c = useColors();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const [settings, setSettings] = useState<BackupSettings>({ schedule: "off", folderUri: null });
  const [saved, setSaved] = useState(false);
  const [last, setLast] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setSettings(await loadBackupSettings());
    setSaved((await loadSavedPassphrase()) !== null);
    setLast(lastAutoBackupTime());
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!api) return null;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setStatus(null);
    try {
      await action();
    } catch (e) {
      setStatus({ text: describeError(e, "That did not work."), error: true });
    } finally {
      setBusy(false);
    }
  }

  const createProblem = passphraseProblem(passphrase, confirm);

  const create = () =>
    run(async () => {
      if (!api || createProblem) return;
      const backup = await api.createBackup(passphrase);
      const name = manualBackupName(new Date());
      const where = await keepBackup(name, backup.data_base64, settings.folderUri);
      const kept = [
        where.inApp ? "in the app's backup folder" : null,
        where.inFolder ? "in your chosen folder" : null,
        where.inFolder === false ? "(could not write to your chosen folder)" : null,
      ]
        .filter(Boolean)
        .join(" ");
      let shared = "";
      try {
        await shareBackup(name, backup.data_base64);
      } catch (e) {
        shared = ` Sharing failed: ${describeError(e, "unknown error")}.`;
      }
      setPassphrase("");
      setConfirm("");
      setStatus({
        text:
          `Backup of ${backup.transactions} transactions and ${backup.receipts} receipts created${kept ? ` ${kept}` : ""}.` +
          (isWeb ? "" : " A copy inside the app is lost with the phone: send it to cloud storage or another device.") +
          shared,
      });
    });

  const restore = () =>
    run(async () => {
      if (!api) return;
      const data = await pickBackupFile();
      if (data === null) return;
      const r = await api.restoreBackup(passphrase, data);
      setPassphrase("");
      setStatus({
        text: `Restored: ${r.transactions_added} new transactions (${r.transactions_known} already here) and ${r.receipts_added} receipts.`,
      });
    });

  const setSchedule = (schedule: BackupSchedule) =>
    run(async () => {
      const next = { ...settings, schedule };
      await saveBackupSettings(next);
      setSettings(next);
      if (schedule !== "off" && api) {
        const r = await runAutoBackupIfDue(api);
        if (r.status === "failed") setStatus({ text: r.message, error: true });
        setLast(lastAutoBackupTime());
      }
    });

  const remember = () =>
    run(async () => {
      const problem = passphraseProblem(passphrase);
      if (problem) {
        setStatus({ text: problem, error: true });
        return;
      }
      await savePassphrase(passphrase);
      setPassphrase("");
      setConfirm("");
      setSaved(true);
      setStatus({ text: "Passphrase saved in this phone's secure storage. You can now switch on automatic backups." });
    });

  const forget = () =>
    run(async () => {
      await forgetPassphrase();
      const next = { ...settings, schedule: "off" as const };
      await saveBackupSettings(next);
      setSettings(next);
      setSaved(false);
      setStatus({ text: "Passphrase removed. Automatic backups are off." });
    });

  const pickFolder = () =>
    run(async () => {
      const uri = await chooseBackupFolder();
      if (uri === null) return;
      const next = { ...settings, folderUri: uri };
      await saveBackupSettings(next);
      setSettings(next);
      setStatus({ text: "Backups are also written to the folder you chose." });
    });

  const clearFolder = () =>
    run(async () => {
      const next = { ...settings, folderUri: null };
      await saveBackupSettings(next);
      setSettings(next);
    });

  return (
    <Card>
      <Text variant="titleMedium">Backup</Text>
      <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
        An encrypted file with all your data. Only the passphrase opens it, and nobody can recover it for you. A copy that
        stays inside the app does not survive losing or resetting the phone, so send the file somewhere else too (cloud
        storage, another device).
      </Text>
      <TextInput
        mode="outlined"
        label="Passphrase (at least 8 characters)"
        accessibilityLabel="Backup passphrase"
        value={passphrase}
        onChangeText={setPassphrase}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={{ marginTop: 8 }}
      />
      <TextInput
        mode="outlined"
        label="Repeat passphrase (to create)"
        accessibilityLabel="Repeat backup passphrase"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
        style={{ marginTop: 8 }}
      />
      {passphrase.length > 0 && confirm.length > 0 && createProblem ? <HelperText type="error" visible>{createProblem}</HelperText> : null}
      <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
        <View style={{ flex: 1 }}>
          <Button
            label={busy ? "Working…" : isWeb ? "Create and download" : "Create and share"}
            icon="shield-lock-outline"
            onPress={create}
            disabled={busy || createProblem !== null}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Button label="Restore" icon="backup-restore" mode="outlined" onPress={restore} disabled={busy || passphrase === ""} />
        </View>
      </View>
      <Text variant="bodySmall" style={{ color: c.muted, marginTop: 8 }}>
        Restore adds the data from a backup file to what is here (type its passphrase first). Restoring twice changes nothing.
      </Text>

      {canKeepBackupsOnDevice ? (
        <>
          <View style={{ height: 1, backgroundColor: c.border, marginVertical: 16 }} />
          <Text variant="titleSmall">Automatic backups</Text>
          <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
            When you open the app and the newest automatic backup is older than the interval, a new one is saved in the app's
            backup folder (the last 3 are kept). To do that without asking, the phone has to remember the passphrase: it is
            kept in this phone's secure storage, only if you choose so below.
          </Text>
          <SegmentedButtons
            style={{ marginTop: 12 }}
            value={settings.schedule}
            onValueChange={(v) => saved && !busy && void setSchedule(v as BackupSchedule)}
            buttons={[
              { value: "off", label: "Off" },
              { value: "daily", label: "Daily" },
              { value: "weekly", label: "Weekly" },
            ]}
          />
          {!saved ? (
            <HelperText type="info" visible>
              Type a passphrase above and save it to turn automatic backups on.
            </HelperText>
          ) : settings.schedule !== "off" ? (
            <HelperText type="info" visible>
              {last ? `Latest automatic backup: ${new Date(last).toLocaleString()}.` : "No automatic backup yet."}
            </HelperText>
          ) : null}
          <View style={{ marginTop: 8 }}>
            {saved ? (
              <Button label="Forget the saved passphrase" icon="key-remove" mode="text" onPress={forget} disabled={busy} />
            ) : (
              <Button
                label="Remember passphrase on this phone"
                icon="key-outline"
                mode="outlined"
                onPress={remember}
                disabled={busy || passphrase === ""}
              />
            )}
          </View>
          {canPickBackupFolder ? (
            <View style={{ marginTop: 4 }}>
              {settings.folderUri ? (
                <Button label="Stop writing to my folder" icon="folder-remove-outline" mode="text" onPress={clearFolder} disabled={busy} />
              ) : (
                <Button label="Also write to a folder I choose" icon="folder-outline" mode="outlined" onPress={pickFolder} disabled={busy} />
              )}
              <Text variant="bodySmall" style={{ color: c.muted, marginTop: 4 }}>
                A folder that a cloud app syncs makes the backup survive losing the phone.
              </Text>
            </View>
          ) : null}
        </>
      ) : null}
      {status ? <HelperText type={status.error ? "error" : "info"} visible>{status.text}</HelperText> : null}
    </Card>
  );
}
