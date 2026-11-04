/**
 * Reading your REWE receipts inside the app's own browser window, without any cookie leaving it.
 *
 * You sign in to REWE's web shop in that window. Once signed in, a small script that the app runs
 * inside the page asks the shop's own receipts address (`/api/receipts/`, with the page's session)
 * for the list, then for each new receipt, and hands the answers to the app, which pushes them to
 * the server. The page's cookies never leave the window, whether they are readable by scripts or
 * not. Pure helpers (no React Native), unit-tested.
 *
 * The shape of the answers (`items` with `receiptId`, `receiptTimestamp`, `receiptTotalPrice`; a
 * receipt's `articles` with `productName`, `quantity`, `totalPrice`, prices in cents) is the one the
 * open-source project grocy-rewe-connect uses. It is not an official interface and was not checked
 * against a live account, so everything is read leniently.
 */

/** Where the window opens: REWE's web shop, which asks you to sign in when you are not. */
export const REWE_START_URL = "https://shop.rewe.de/";
const REWE_HOST = "shop.rewe.de";

/** Receipts whose details are fetched in one run (the rest follow on the next). */
export const MAX_PER_RUN = 30;

/** May the window load this address? Only REWE's own pages (the sign-in may sit on another rewe.de host). */
export function isReweUrl(url: string): boolean {
  const m = /^https:\/\/([a-z0-9.-]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);
  if (!m) return false;
  const host = m[1].toLowerCase();
  return host === "rewe.de" || host.endsWith(".rewe.de");
}

/** Is a message from this page to be trusted (it came from the shop itself, not from some other page)? */
export function isShopPage(url: string | undefined): boolean {
  if (!url) return false;
  const m = /^https:\/\/([a-z0-9.-]+)(?::\d+)?(?:[/?#]|$)/i.exec(url);
  return m !== null && m[1].toLowerCase() === REWE_HOST;
}

/** Runs in the page: asks for the list of receipts and reports the answer. */
export const LIST_SCRIPT = `(function () {
  function send(status, body) {
    window.ReactNativeWebView.postMessage(JSON.stringify({ kind: "list", status: status, body: body }));
  }
  fetch("/api/receipts/", { credentials: "include", headers: { Accept: "application/json" } })
    .then(function (r) { return r.text().then(function (t) { send(r.status, t.slice(0, 2000000)); }); })
    .catch(function () { send(0, ""); });
  true;
})();`;

const ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Is this a receipt id that is safe to put into a script and an address? */
export function isReceiptId(id: string): boolean {
  return ID.test(id);
}

/** Runs in the page: fetches the given receipts one after the other and reports each, then "done". */
export function detailScript(ids: readonly string[]): string {
  const safe = ids.filter(isReceiptId);
  return `(function () {
  var ids = ${JSON.stringify(safe)};
  function send(o) { window.ReactNativeWebView.postMessage(JSON.stringify(o)); }
  function next(i) {
    if (i >= ids.length) { send({ kind: "done" }); return; }
    fetch("/api/receipts/" + encodeURIComponent(ids[i]), { credentials: "include", headers: { Accept: "application/json" } })
      .then(function (r) { return r.text().then(function (t) { send({ kind: "detail", id: ids[i], status: r.status, body: t.slice(0, 2000000) }); }); })
      .catch(function () { send({ kind: "detail", id: ids[i], status: 0, body: "" }); })
      .then(function () { setTimeout(function () { next(i + 1); }, 400); });
  }
  next(0);
  true;
})();`;
}

export type WebMessage =
  | { kind: "list"; status: number; body: string }
  | { kind: "detail"; id: string; status: number; body: string }
  | { kind: "done" };

/** What the page sent, or null when it is not one of the three messages. */
export function parseMessage(raw: string): WebMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.kind === "done") return { kind: "done" };
  const status = typeof o.status === "number" ? o.status : null;
  const body = typeof o.body === "string" ? o.body : null;
  if (status === null || body === null) return null;
  if (o.kind === "list") return { kind: "list", status, body };
  if (o.kind === "detail" && typeof o.id === "string" && isReceiptId(o.id)) return { kind: "detail", id: o.id, status, body };
  return null;
}

export type ListEntry = { id: string; at: number | string | null; totalCents: number | null };

function idOf(v: unknown): string | null {
  const s = typeof v === "number" ? String(v) : typeof v === "string" ? v : null;
  return s !== null && isReceiptId(s) ? s : null;
}

function cents(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 100_000_000 ? Math.round(v) : null;
}

/** The receipts of the list answer, newest first as sent; null when the answer is not a list (not signed in). */
export function parseList(body: string): ListEntry[] | null {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    return null;
  }
  const items = v && typeof v === "object" ? (v as { items?: unknown }).items : null;
  if (!Array.isArray(items)) return null;
  const out: ListEntry[] = [];
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const o = it as Record<string, unknown>;
    const id = idOf(o.receiptId);
    if (!id) continue;
    const at = typeof o.receiptTimestamp === "number" || typeof o.receiptTimestamp === "string" ? o.receiptTimestamp : null;
    out.push({ id, at, totalCents: cents(o.receiptTotalPrice) });
  }
  return out;
}

/** Local day and time of a stamp (milliseconds or seconds since 1970, or an ISO text). `offsetMinutes` is the zone, the phone's by default. */
export function localStamp(at: number | string, offsetMinutes?: number): { date: string; time: string } | null {
  const ms = typeof at === "number" ? (Math.abs(at) < 100_000_000_000 ? at * 1000 : at) : Date.parse(at);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return null;
  const offset = offsetMinutes ?? -d.getTimezoneOffset();
  const local = new Date(ms + offset * 60_000);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return {
    date: `${p(local.getUTCFullYear(), 4)}-${p(local.getUTCMonth() + 1)}-${p(local.getUTCDate())}`,
    time: `${p(local.getUTCHours())}:${p(local.getUTCMinutes())}`,
  };
}

/** What the server's import wants for one receipt. */
export type ImportReceipt = {
  id: string;
  date: string;
  time: string | null;
  store: string | null;
  total_cents: number | null;
  lines: { name: string; quantity: number; total_cents: number }[];
};

/** A receipt from its list entry and the detail answer; null when there is nothing to store (no date or no lines). */
export function toImport(entry: ListEntry, detailBody: string, offsetMinutes?: number): ImportReceipt | null {
  if (entry.at === null) return null;
  const stamp = localStamp(entry.at, offsetMinutes);
  if (!stamp) return null;
  let v: unknown;
  try {
    v = JSON.parse(detailBody);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const articles = Array.isArray(o.articles) ? o.articles : [];
  const lines: ImportReceipt["lines"] = [];
  for (const a of articles.slice(0, 500)) {
    if (!a || typeof a !== "object") continue;
    const r = a as Record<string, unknown>;
    // lines without a product name are deposit, counter goods and the like: left out
    const name = typeof r.productName === "string" ? r.productName.trim().slice(0, 200) : "";
    const total = cents(r.totalPrice);
    if (!name || total === null) continue;
    const q = typeof r.quantity === "number" && Number.isInteger(r.quantity) && r.quantity >= 1 && r.quantity <= 99 ? r.quantity : 1;
    lines.push({ name, quantity: q, total_cents: total });
  }
  if (lines.length === 0) return null;
  const market = o.market && typeof o.market === "object" ? (o.market as Record<string, unknown>).name : undefined;
  const storeRaw = [o.marketName, market, o.storeName].find((s) => typeof s === "string" && s.trim() !== "");
  return {
    id: entry.id,
    date: stamp.date,
    time: stamp.time,
    store: typeof storeRaw === "string" ? storeRaw.trim().slice(0, 80) : null,
    total_cents: entry.totalCents,
    lines,
  };
}

/** The ids to read this run: the unknown ones among the listed, newest first, at most `MAX_PER_RUN`. */
export function idsToRead(list: readonly ListEntry[], unknown: readonly string[]): string[] {
  const wanted = new Set(unknown);
  return list.filter((e) => wanted.has(e.id)).slice(0, MAX_PER_RUN).map((e) => e.id);
}

/** One line for the end of a run. */
export function runText(r: { imported: number; duplicates: number; skipped: number; linked: number }, left: number): string {
  const parts = [r.imported === 0 ? "No new receipts" : r.imported === 1 ? "1 new receipt" : `${r.imported} new receipts`];
  if (r.linked > 0) parts.push(`${r.linked} matched to a bank payment`);
  if (r.skipped > 0) parts.push(`${r.skipped} could not be read`);
  if (left > 0) parts.push(`${left} more follow next time`);
  return parts.join(", ") + ".";
}
