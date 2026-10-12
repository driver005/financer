/**
 * Pure logic for the Bank connections card in Settings. The connections themselves are described
 * in the server's financer.toml; the server logs in, waits for the approval in the banking app and
 * imports. The card only shows the state and starts or cancels a sync.
 */
import type { BankConnection } from "./api/client";

/** How often the card asks the server while a sync is running. */
export const POLL_MS = 3000;

export function isBusy(c: BankConnection): boolean {
  return c.state === "syncing" || c.state === "needs_approval";
}

export function anyBusy(list: BankConnection[]): boolean {
  return list.some(isBusy);
}

/** The text of the state chip. */
export function stateLabel(c: BankConnection): string {
  switch (c.state) {
    case "syncing":
      return "Syncing";
    case "needs_approval":
      return "Needs approval";
    case "error":
      return "Error";
    default:
      return c.sync_due ? "Sync due" : "Ready";
  }
}

export type Tone = "bad" | "warn" | "good" | "muted";

export function stateTone(c: BankConnection): Tone {
  switch (c.state) {
    case "syncing":
    case "needs_approval":
      return "warn";
    case "error":
      return "bad";
    default:
      return c.sync_due ? "warn" : "good";
  }
}

/** The PIN has to be typed in the app unless the server has it in the environment. */
export function needsTypedPin(c: BankConnection): boolean {
  return !c.pin_from_env;
}

/** Whether "Sync now" can be pressed with what has been typed. */
export function canSync(c: BankConnection, typedPin: string): boolean {
  return !isBusy(c) && (c.pin_from_env || typedPin.length > 0);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** `12.10.2026 14:03` in the device's time zone. */
export function formatStamp(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** What the last attempt did, or `null` when there was none. */
export function lastResultText(c: BankConnection): string | null {
  const r = c.last_result;
  if (!r) return null;
  if (!r.ok) return `Last attempt ${formatStamp(r.at)} failed.`;
  const imported = r.imported ?? 0;
  const known = r.duplicates ?? 0;
  return `Last sync ${formatStamp(r.at)}: ${imported} new, ${known} already known.`;
}

/** When the next scheduled sync is, in words. */
export function nextSyncText(c: BankConnection, nowSeconds: number): string | null {
  if (c.sync_every_hours <= 0) return "Syncs only when you press Sync now.";
  if (c.next_sync_at === null || c.next_sync_at === undefined) return null;
  const mins = Math.round((c.next_sync_at - nowSeconds) / 60);
  const every = c.sync_every_hours === 1 ? "every hour" : `every ${c.sync_every_hours} hours`;
  if (c.sync_due) return `Scheduled ${every}. Due now: press Sync now and enter your PIN, the server has none.`;
  if (mins <= 0) return `Scheduled ${every}. Due now.`;
  if (mins < 90) return `Scheduled ${every}. Next in about ${mins} minute${mins === 1 ? "" : "s"}.`;
  return `Scheduled ${every}. Next in about ${Math.round(mins / 60)} hours.`;
}

/** How long the server keeps waiting for the approval. */
export function approvalLeftText(c: BankConnection, nowSeconds: number): string | null {
  if (c.state !== "needs_approval" || c.approval_expires_at === null || c.approval_expires_at === undefined) return null;
  const secs = c.approval_expires_at - nowSeconds;
  if (secs <= 0) return "Time is about up.";
  const mins = Math.ceil(secs / 60);
  return `The server waits about ${mins} more minute${mins === 1 ? "" : "s"}.`;
}

/** `Girokonto` -> a stable key for React lists and PIN fields. */
export function connectionKey(c: BankConnection): string {
  return c.name.trim().toLowerCase();
}
