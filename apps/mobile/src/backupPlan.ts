// Automatic backups: when one is due, how the files are named, which to delete. The rules are in Rust
// (crates/logic, backup_plan.rs); times cross over as milliseconds since 1970.
import { logic } from "../../../packages/wire/src/logic";

export type BackupSchedule = "off" | "daily" | "weekly";

export const SCHEDULE_DAYS: Record<Exclude<BackupSchedule, "off">, number> = { daily: 1, weekly: 7 };

/** How many automatic backups are kept; older ones are deleted. */
export const KEEP_AUTO_BACKUPS = 3;

export type BackupSettings = {
  schedule: BackupSchedule;
  /** URI of a folder the user picked, where copies are written as well (if the platform allows). */
  folderUri: string | null;
};

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { schedule: "off", folderUri: null };

/** Read stored settings, tolerating anything (missing, old, hand-edited, corrupt). */
export const parseBackupSettings = (raw: string | null | undefined): BackupSettings => logic("backup_plan.parse_backup_settings", { raw: raw ?? null });

/** File name of an automatic backup made at `at` (UTC, sorts chronologically). */
export const autoBackupName = (at: Date): string => logic("backup_plan.auto_backup_name", { ms: at.getTime() });

/** Manual backups: a date in the name, easy for people to tell apart. */
export const manualBackupName = (at: Date): string => logic("backup_plan.manual_backup_name", { ms: at.getTime() });

/** When an automatic backup file was made (from its name), or `null` if it is not one of ours. */
export const autoBackupTime = (name: string): number | null => logic("backup_plan.auto_backup_time", { name });

/** Time of the newest automatic backup among `names`, or `null` if there is none. */
export const newestAutoBackup = (names: string[]): number | null => logic("backup_plan.newest_auto_backup", { names });

/** Is a new automatic backup due? (a newest backup far in the future means a wrong clock: due.) */
export const isBackupDue = (schedule: BackupSchedule, newestMs: number | null, nowMs: number): boolean =>
  logic("backup_plan.is_backup_due", { schedule, newest_ms: newestMs, now_ms: nowMs });

/** Automatic backups to delete so that only the newest `keep` remain. Other files are never touched. */
export const autoBackupsToDelete = (names: string[], keep: number = KEEP_AUTO_BACKUPS): string[] => logic("backup_plan.auto_backups_to_delete", { names, keep });

/** Passphrase rules shared by the screen and the server (which needs at least 8 characters). */
export const MIN_PASSPHRASE_LENGTH = 8;

export const passphraseProblem = (passphrase: string, confirm?: string): string | null => logic("backup_plan.passphrase_problem", { passphrase, confirm: confirm ?? null });
