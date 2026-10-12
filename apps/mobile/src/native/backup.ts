import { Directory, File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";
import { Platform } from "react-native";

import type { Api } from "@/api/client";
import { deleteSecret, getSecret, setSecret } from "@/api/storage";
import {
  autoBackupName,
  autoBackupsToDelete,
  isBackupDue,
  newestAutoBackup,
  parseBackupSettings,
  type BackupSettings,
} from "@/backupPlan";
import { pickFileBytes } from "@/native/files";
import { toBase64 } from "@/native/base64";

const SETTINGS_KEY = "financer.backup-settings";
const PASSPHRASE_KEY = "financer.backup-passphrase";
const MIME = "application/octet-stream";

const isWeb = Platform.OS === "web";

/** Whether this build can keep backup files on the phone (not in the browser). */
export const canKeepBackupsOnDevice = !isWeb;

/** Whether the platform's folder picker exists here (it does on a phone, not in the browser). */
export const canPickBackupFolder = !isWeb && typeof Directory.pickDirectoryAsync === "function";

// ---- stored settings ----

export async function loadBackupSettings(): Promise<BackupSettings> {
  try {
    return parseBackupSettings(await getSecret(SETTINGS_KEY));
  } catch {
    return parseBackupSettings(null);
  }
}

export async function saveBackupSettings(settings: BackupSettings): Promise<void> {
  await setSecret(SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * The passphrase for automatic backups. It lives in the platform's secure storage (Keychain or
 * Keystore) and only if the user chose to save it; never on the web, where "secure storage" is
 * just localStorage.
 */
export async function loadSavedPassphrase(): Promise<string | null> {
  if (isWeb) return null;
  try {
    return await getSecret(PASSPHRASE_KEY);
  } catch {
    return null;
  }
}

export async function savePassphrase(passphrase: string): Promise<void> {
  if (isWeb) throw new Error("Saving the passphrase is not available in the browser.");
  await setSecret(PASSPHRASE_KEY, passphrase);
}

export async function forgetPassphrase(): Promise<void> {
  try {
    await deleteSecret(PASSPHRASE_KEY);
  } catch {
    // nothing stored
  }
}

// ---- files ----

/** The app's own backup folder (inside the app sandbox: removed with the app, lost with the phone). */
function appBackupDir(): Directory {
  const dir = new Directory(Paths.document, "backups");
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function writeBase64(dir: Directory, name: string, base64: string): File {
  const file = new File(dir, name);
  file.create({ overwrite: true });
  file.write(base64, { encoding: "base64" });
  return file;
}

function namesIn(dir: Directory): string[] {
  return dir.list().map((entry) => entry.name);
}

function deleteStaleAutoBackups(dir: Directory): void {
  for (const name of autoBackupsToDelete(namesIn(dir))) {
    try {
      new File(dir, name).delete();
    } catch {
      // already gone, or the folder does not allow deleting: not worth failing a backup over
    }
  }
}

/** Let the user pick a folder (for example one synced to the cloud). `null` if they cancel. */
export async function chooseBackupFolder(): Promise<string | null> {
  if (!canPickBackupFolder) return null;
  try {
    return (await Directory.pickDirectoryAsync()).uri;
  } catch {
    return null; // cancelled, or the system refused
  }
}

/** Write `name` into the user's folder; returns whether it worked. */
function copyToFolder(folderUri: string, name: string, base64: string): boolean {
  try {
    const dir = new Directory(folderUri);
    const file = dir.createFile(name, MIME);
    file.write(base64, { encoding: "base64" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Keep a copy in the app's backup folder, and in the user's folder if they chose one. Returns
 * where it went (for the status line).
 */
export async function keepBackup(
  name: string,
  base64: string,
  folderUri: string | null,
): Promise<{ inApp: boolean; inFolder: boolean | null }> {
  if (isWeb) return { inApp: false, inFolder: null };
  let inApp = false;
  try {
    writeBase64(appBackupDir(), name, base64);
    inApp = true;
  } catch {
    // disk full or similar: the share sheet may still work
  }
  return { inApp, inFolder: folderUri ? copyToFolder(folderUri, name, base64) : null };
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Hand the backup to the user: the share sheet on a phone (cloud storage, mail...), a download in the browser. */
export async function shareBackup(name: string, base64: string): Promise<void> {
  if (isWeb) {
    const url = URL.createObjectURL(new Blob([base64ToBytes(base64)], { type: MIME }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("Sharing is not available on this device.");
  // share from the cache so it works even when the app folder copy could not be written
  const file = writeBase64(Paths.cache, name, base64);
  try {
    await Sharing.shareAsync(file.uri, { mimeType: MIME, UTI: "public.data", dialogTitle: name });
  } finally {
    try {
      file.delete();
    } catch {
      // the OS clears the cache eventually; the file is encrypted anyway
    }
  }
}

/** Let the user pick a backup file; returns it as base64, or `null` if they cancel. */
export async function pickBackupFile(): Promise<string | null> {
  const bytes = await pickFileBytes(["*/*"]);
  return bytes === null ? null : toBase64(bytes);
}

/** Time of the newest automatic backup in the app folder, or `null`. */
export function lastAutoBackupTime(): number | null {
  if (isWeb) return null;
  try {
    return newestAutoBackup(namesIn(appBackupDir()));
  } catch {
    return null;
  }
}

// ---- automatic backups ----

export type AutoBackupResult =
  | { status: "off" | "not_due" | "no_passphrase" | "unsupported" | "busy" }
  | { status: "done"; name: string; inFolder: boolean | null }
  | { status: "failed"; message: string };

let running: Promise<AutoBackupResult> | null = null;

/**
 * If automatic backups are on and the newest one is older than the chosen interval, write a new
 * one (and keep only the last three). Safe to call often: it does nothing when no backup is due,
 * and never runs twice at once.
 */
export function runAutoBackupIfDue(api: Api, now: number = Date.now()): Promise<AutoBackupResult> {
  if (isWeb) return Promise.resolve({ status: "unsupported" });
  if (running) return Promise.resolve({ status: "busy" });
  running = (async (): Promise<AutoBackupResult> => {
    try {
      const settings = await loadBackupSettings();
      if (settings.schedule === "off") return { status: "off" };
      const passphrase = await loadSavedPassphrase();
      if (!passphrase) return { status: "no_passphrase" };
      const dir = appBackupDir();
      if (!isBackupDue(settings.schedule, newestAutoBackup(namesIn(dir)), now)) return { status: "not_due" };

      const backup = await api.createBackup(passphrase);
      const name = autoBackupName(new Date(now));
      writeBase64(dir, name, backup.data_base64);
      deleteStaleAutoBackups(dir);
      let inFolder: boolean | null = null;
      if (settings.folderUri) {
        inFolder = copyToFolder(settings.folderUri, name, backup.data_base64);
        if (inFolder) {
          try {
            const folder = new Directory(settings.folderUri);
            for (const stale of autoBackupsToDelete(namesIn(folder))) {
              try {
                new File(folder, stale).delete();
              } catch {
                // not allowed to delete there: leave old copies alone
              }
            }
          } catch {
            // unreadable folder: the new copy is written, pruning is best effort
          }
        }
      }
      return { status: "done", name, inFolder };
    } catch (e) {
      // the message comes from the backend or the file system; the passphrase is never part of it
      return { status: "failed", message: e instanceof Error ? e.message : "Automatic backup failed" };
    }
  })().finally(() => {
    running = null;
  });
  return running;
}
