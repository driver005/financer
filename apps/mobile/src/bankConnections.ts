/**
 * Pure logic for the Bank connections card in Settings. The connections themselves are described
 * in the server's financer.toml, each with a provider: FinTS (the server logs in, waits for the
 * approval in the banking app and imports) or Plaid (you sign in once on Plaid's page; after that
 * there is no PIN and no approval). The card only shows the state and starts or cancels a sync.
 */
import type { BankConnection } from "./api/client";

/** How often the card asks the server while a sync is running. */
export const POLL_MS = 3000;

export function isBusy(c: BankConnection): boolean {
  return c.state === "syncing" || c.state === "needs_approval" || c.state === "needs_link";
}

export function isPlaid(c: BankConnection): boolean {
  return c.kind === "plaid";
}

/** A Plaid connection that has not been signed in to a bank yet. */
export function needsLinking(c: BankConnection): boolean {
  return isPlaid(c) && !c.linked;
}

/** `Plaid` or `Bank (FinTS)`, for the line under the name. */
export function providerLabel(c: BankConnection): string {
  return isPlaid(c) ? "Plaid" : "Bank (FinTS)";
}

/** The line under the connection's name: what it is connected to. */
export function connectionSubtitle(c: BankConnection): string {
  if (!isPlaid(c)) return `Bank code ${c.bank_code} · login ${c.login_masked} · ${c.iban_masked}`;
  if (!c.linked) return "Plaid · not connected yet";
  const n = c.accounts.length;
  return n === 0 ? "Plaid · connected" : `Plaid · ${n} account${n === 1 ? "" : "s"} connected`;
}

/** The linked accounts as `Giro ••0000, Tagesgeld ••1111`, or `null` when there are none. */
export function linkedAccountsText(c: BankConnection): string | null {
  if (c.accounts.length === 0) return null;
  return c.accounts.map((a) => (a.mask ? `${a.name} ••${a.mask}` : a.name)).join(", ");
}

/** What the main button says. */
export function syncButtonLabel(c: BankConnection, starting: boolean): string {
  if (starting) return needsLinking(c) ? "Opening…" : "Starting…";
  return needsLinking(c) ? "Connect your bank" : "Sync now";
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
    case "needs_link":
      return "Sign in to your bank";
    case "error":
      return "Error";
    default:
      if (needsLinking(c)) return "Not connected";
      return c.sync_due ? "Sync due" : "Ready";
  }
}

export type Tone = "bad" | "warn" | "good" | "muted";

export function stateTone(c: BankConnection): Tone {
  switch (c.state) {
    case "syncing":
    case "needs_approval":
    case "needs_link":
      return "warn";
    case "error":
      return "bad";
    default:
      if (needsLinking(c)) return "muted";
      return c.sync_due ? "warn" : "good";
  }
}

/** A FinTS PIN has to be typed in the app unless the server has it in the environment. Plaid has no PIN. */
export function needsTypedPin(c: BankConnection): boolean {
  return !isPlaid(c) && !c.pin_from_env;
}

/** Whether the main button can be pressed with what has been typed. */
export function canSync(c: BankConnection, typedPin: string): boolean {
  return !isBusy(c) && (isPlaid(c) || c.pin_from_env || typedPin.length > 0);
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
  if (needsLinking(c)) {
    return "Press Connect your bank to sign in once on Plaid's page. After that a sync needs no PIN and no approval.";
  }
  if (c.sync_every_hours <= 0) return "Syncs only when you press Sync now.";
  if (c.next_sync_at === null || c.next_sync_at === undefined) return null;
  const mins = Math.round((c.next_sync_at - nowSeconds) / 60);
  const every = c.sync_every_hours === 1 ? "every hour" : `every ${c.sync_every_hours} hours`;
  if (c.sync_due) return `Scheduled ${every}. Due now: press Sync now and enter your PIN, the server has none.`;
  if (mins <= 0) return `Scheduled ${every}. Due now.`;
  if (mins < 90) return `Scheduled ${every}. Next in about ${mins} minute${mins === 1 ? "" : "s"}.`;
  return `Scheduled ${every}. Next in about ${Math.round(mins / 60)} hours.`;
}

/** How long the server keeps waiting for the approval, or for you to finish signing in on Plaid's page. */
export function approvalLeftText(c: BankConnection, nowSeconds: number): string | null {
  if (c.state !== "needs_approval" && c.state !== "needs_link") return null;
  if (c.approval_expires_at === null || c.approval_expires_at === undefined) return null;
  const secs = c.approval_expires_at - nowSeconds;
  if (secs <= 0) return "Time is about up.";
  const mins = Math.ceil(secs / 60);
  return `The server waits about ${mins} more minute${mins === 1 ? "" : "s"}.`;
}

/** Only a web address that Plaid hands out is opened: https, on a plaid.com host. */
export function isSafeLinkUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === "https:" && (u.hostname === "plaid.com" || u.hostname.endsWith(".plaid.com"));
  } catch {
    return false;
  }
}

/** `Girokonto` -> a stable key for React lists and PIN fields. */
export function connectionKey(c: BankConnection): string {
  return c.name.trim().toLowerCase();
}

/** What to tell someone when live bank sync has no FinTS product id yet. */
export function liveSyncMissing(onPhone: boolean): { title: string; body: string } {
  return onPhone
    ? {
        title: "Live sync is not set up on this phone",
        body: "It needs a FinTS product id, which you request from the Deutsche Kreditwirtschaft. Add it under Settings > On-phone settings. See docs/FINTS.md. Until then, import a CSV export on the Spending tab.",
      }
    : {
        title: "Live sync is not set up on the server",
        body: "It needs a FinTS product id (FINANCER_FINTS_PRODUCT_ID, or bank.fints_product_id in financer.toml), which you request from the Deutsche Kreditwirtschaft. See docs/FINTS.md. Until then, import a CSV export on the Spending tab.",
      };
}
