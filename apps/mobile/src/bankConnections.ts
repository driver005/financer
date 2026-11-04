/**
 * The Bank connections card in Settings. The connections themselves are described in the server's
 * financer.toml, each with a provider: FinTS (the server logs in, waits for the approval in the
 * banking app and imports), or Plaid, GoCardless or finAPI (you sign in once on the provider's page;
 * after that there is no PIN and no approval). The card only shows the state and starts or cancels
 * a sync. The rules are in Rust (crates/logic, bank_connections.rs); the time-zone stamp and the
 * waiting loop stay here, with the device.
 */
import { logic } from "../../../packages/wire/src/logic";
import type { BankConnection, Sync } from "./api/client";

/** How often the card asks the server while a sync is running. */
export const POLL_MS = 3000;

export const isBusy = (c: BankConnection): boolean => logic("bank_connections.is_busy", { c });

export const isPlaid = (c: BankConnection): boolean => logic("bank_connections.is_plaid", { c });

/** Plaid, GoCardless and finAPI: sign in once on the provider's page, then no PIN and no approval. */
export const linksOnce = (c: Pick<BankConnection, "kind">): boolean => logic("bank_connections.links_once", { c });

/** A connection that has not been signed in to a bank yet (Plaid, GoCardless, finAPI). */
export const needsLinking = (c: BankConnection): boolean => logic("bank_connections.needs_linking", { c });

/** `Plaid`, `GoCardless`, `finAPI` or `Bank (FinTS)`, for the line under the name. */
export const providerLabel = (c: Pick<BankConnection, "kind">): string => logic("bank_connections.provider_label", { c });

/** The line under the connection's name: what it is connected to. */
export const connectionSubtitle = (c: BankConnection): string => logic("bank_connections.connection_subtitle", { c });

/** The linked accounts as `Giro ••0000, Tagesgeld ••1111`, or `null` when there are none. */
export const linkedAccountsText = (c: BankConnection): string | null => logic("bank_connections.linked_accounts_text", { c });

/** What the main button says. */
export const syncButtonLabel = (c: BankConnection, starting: boolean): string => logic("bank_connections.sync_button_label", { c, starting });

export const anyBusy = (list: BankConnection[]): boolean => logic("bank_connections.any_busy", { list });

/** The text of the state chip. */
export const stateLabel = (c: BankConnection): string => logic("bank_connections.state_label", { c });

export type Tone = "bad" | "warn" | "good" | "muted";

export const stateTone = (c: BankConnection): Tone => logic("bank_connections.state_tone", { c });

/** A FinTS PIN has to be typed in the app unless the server has it in the environment. The others have no PIN. */
export const needsTypedPin = (c: BankConnection): boolean => logic("bank_connections.needs_typed_pin", { c });

/** Whether the main button can be pressed with what has been typed. */
export const canSync = (c: BankConnection, typedPin: string): boolean => logic("bank_connections.can_sync", { c, typed_pin: typedPin });

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
export const nextSyncText = (c: BankConnection, nowSeconds: number): string | null =>
  logic("bank_connections.next_sync_text", { c, now_seconds: nowSeconds });

/** How long the server keeps waiting for the approval, or for you to finish signing in on the provider's page. */
export const approvalLeftText = (c: BankConnection, nowSeconds: number): string | null =>
  logic("bank_connections.approval_left_text", { c, now_seconds: nowSeconds });

/** Only a web address that one of the providers hands out is opened: https, on one of their hosts. */
export const isSafeLinkUrl = (url: string | null | undefined): url is string =>
  !!url && logic<boolean>("bank_connections.is_safe_link_url", { url });

/** `Girokonto` -> a stable key for React lists and PIN fields. */
export const connectionKey = (c: BankConnection): string => logic("bank_connections.connection_key", { c });

/** What to tell someone when live bank sync has no FinTS product id yet. */
export const liveSyncMissing = (onPhone: boolean): { title: string; body: string } =>
  logic("bank_connections.live_sync_missing", { on_phone: onPhone });

// ---------------------------------------------------------------- one protocol for every provider

/** A sync is still waiting for something: the bank, an approval, or the sign-in. */
export const isRunning = (s: Pick<Sync, "state">): boolean => logic("bank_connections.is_running", { s });

/** The connection as it looks while the given sync runs (what the sync call and its polls report). */
export const applySync = (c: BankConnection, s: Sync): BankConnection => logic("bank_connections.apply_sync", { c, s });

/** How a finished sync ended, in a sentence; `null` while it runs or when nothing is known. */
export const syncResultText = (s: Sync): string | null => logic("bank_connections.sync_result_text", { s });

export type WaitOptions = { intervalMs?: number; giveUpMs?: number; now?: () => number; onUpdate?: (s: Sync) => void; cancelled?: () => boolean };

/**
 * Ask a started sync again and again until it is over: `poll` fetches it, `sleep` waits between asks.
 * Resolves with the last answer, which is still running when the person gave up (`cancelled`) or the
 * time ran out (`giveUpMs`).
 */
export async function waitForSync(first: Sync, poll: (id: string) => Promise<Sync>, sleep: (ms: number) => Promise<void>, opts: WaitOptions = {}): Promise<Sync> {
  const interval = opts.intervalMs ?? POLL_MS;
  const now = opts.now ?? Date.now;
  const deadline = now() + (opts.giveUpMs ?? 10 * 60 * 1000);
  let current = first;
  opts.onUpdate?.(current);
  while (isRunning(current) && !opts.cancelled?.() && now() < deadline) {
    await sleep(interval);
    if (opts.cancelled?.()) break;
    current = await poll(current.id);
    opts.onUpdate?.(current);
  }
  return current;
}
