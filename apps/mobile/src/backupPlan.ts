// Pure logic for automatic backups: when one is due, how the files are named, which to delete.
// No React Native or Expo imports, so it runs in tests.

export type BackupSchedule = "off" | "daily" | "weekly";

export const SCHEDULE_DAYS: Record<Exclude<BackupSchedule, "off">, number> = { daily: 1, weekly: 7 };

/** How many automatic backups are kept; older ones are deleted. */
export const KEEP_AUTO_BACKUPS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const AUTO_PREFIX = "financer-auto-";
const EXTENSION = ".age";
// financer-auto-20261012T143005Z.age
const AUTO_RE = /^financer-auto-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z\.age$/;

export type BackupSettings = {
  schedule: BackupSchedule;
  /** URI of a folder the user picked, where copies are written as well (if the platform allows). */
  folderUri: string | null;
};

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { schedule: "off", folderUri: null };

/** Read stored settings, tolerating anything (missing, old, hand-edited, corrupt). */
export function parseBackupSettings(raw: string | null | undefined): BackupSettings {
  if (!raw) return { ...DEFAULT_BACKUP_SETTINGS };
  try {
    const v = JSON.parse(raw) as Partial<BackupSettings> | null;
    const schedule = v?.schedule === "daily" || v?.schedule === "weekly" ? v.schedule : "off";
    const folderUri = typeof v?.folderUri === "string" && v.folderUri !== "" ? v.folderUri : null;
    return { schedule, folderUri };
  } catch {
    return { ...DEFAULT_BACKUP_SETTINGS };
  }
}

/** File name of an automatic backup made at `at` (UTC, sorts chronologically). */
export function autoBackupName(at: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return (
    AUTO_PREFIX +
    `${p(at.getUTCFullYear(), 4)}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}` +
    `T${p(at.getUTCHours())}${p(at.getUTCMinutes())}${p(at.getUTCSeconds())}Z` +
    EXTENSION
  );
}

/** Manual backups: a date in the name, easy for people to tell apart. */
export function manualBackupName(at: Date): string {
  return `financer-backup-${at.toISOString().slice(0, 10)}${EXTENSION}`;
}

/** When an automatic backup file was made (from its name), or `null` if it is not one of ours. */
export function autoBackupTime(name: string): number | null {
  const m = AUTO_RE.exec(name);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const t = Date.UTC(y, mo - 1, d, h, mi, s);
  return Number.isFinite(t) ? t : null;
}

/** Time of the newest automatic backup among `names`, or `null` if there is none. */
export function newestAutoBackup(names: string[]): number | null {
  let newest: number | null = null;
  for (const n of names) {
    const t = autoBackupTime(n);
    if (t !== null && (newest === null || t > newest)) newest = t;
  }
  return newest;
}

/**
 * Is a new automatic backup due? Yes when the schedule is on and there is none yet or the newest
 * is at least a day (daily) or seven days (weekly) old. A newest backup that lies more than a
 * day in the future means the clock was wrong when it was made: treat that as due, otherwise a
 * wrong clock would stop backups for good.
 */
export function isBackupDue(schedule: BackupSchedule, newestMs: number | null, nowMs: number): boolean {
  if (schedule === "off") return false;
  if (newestMs === null) return true;
  if (newestMs > nowMs + DAY_MS) return true;
  return nowMs - newestMs >= SCHEDULE_DAYS[schedule] * DAY_MS;
}

/** Automatic backups to delete so that only the newest `keep` remain. Other files are never touched. */
export function autoBackupsToDelete(names: string[], keep: number = KEEP_AUTO_BACKUPS): string[] {
  return names
    .map((name) => ({ name, t: autoBackupTime(name) }))
    .filter((x): x is { name: string; t: number } => x.t !== null)
    .sort((a, b) => b.t - a.t || (a.name < b.name ? 1 : -1))
    .slice(Math.max(0, keep))
    .map((x) => x.name);
}

/** Passphrase rules shared by the screen and the server (which needs at least 8 characters). */
export const MIN_PASSPHRASE_LENGTH = 8;

export function passphraseProblem(passphrase: string, confirm?: string): string | null {
  if ([...passphrase].length < MIN_PASSPHRASE_LENGTH) {
    return `Use at least ${MIN_PASSPHRASE_LENGTH} characters.`;
  }
  if (confirm !== undefined && confirm !== passphrase) return "The two passphrases are different.";
  return null;
}
