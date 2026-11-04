/**
 * Reading an order-history file that an online shop produced (the CSV of Amazon's data request is
 * the main case) into orders for the server. Pure (no React Native), unit-tested.
 *
 * The columns are found by their heading, not by their place, because shops rename them between
 * versions (Amazon's "Total Amount" became "Total Owed"): a heading is compared without case,
 * spaces and punctuation, against a list of names it is known by, English and German. A file whose
 * columns are not found is refused with the headings it has, so nothing is guessed.
 */
import { localStamp } from "./reweSync";

/** Orders per call of the server's import. */
export const BATCH = 200;

/** The text of a CSV as rows of cells. Handles a byte order mark, quoted cells with commas, quotes and line breaks, and `,` `;` or tab as separator. */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^﻿/, "");
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const count = (c: string) => firstLine.split(c).length - 1;
  const sep = count(";") > count(",") && count(";") >= count("\t") ? ";" : count("\t") > count(",") ? "\t" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

const norm = (h: string) => h.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

const NAMES = {
  id: ["orderid", "bestellnummer", "bestellid", "bestellungid", "ordernumber", "orderno"],
  date: ["orderdate", "bestelldatum", "bestelldatumuhrzeit", "dateordered", "date", "datum"],
  name: ["productname", "produktname", "itemtitle", "title", "artikel", "artikelbezeichnung", "artikelname", "itemname", "product"],
  qty: ["quantity", "menge", "anzahl", "qty"],
  total: ["totalowed", "totalamount", "itemtotal", "gesamtbetrag", "gesamtpreis", "gesamt", "total", "amount", "betrag"],
  unit: ["unitprice", "einzelpreis", "stückpreis", "price", "preis"],
  currency: ["currency", "währung", "waehrung"],
  status: ["orderstatus", "status", "bestellstatus"],
  shop: ["website", "shop", "store", "marketplace"],
} as const;

export type Column = keyof typeof NAMES;
export type Columns = Partial<Record<Column, number>>;

/** Which column holds what, or `missing` (the required ones that were not found) with the headings that were there. */
export function detectColumns(header: readonly string[]): { columns: Columns; missing: Column[] } {
  const normal = header.map(norm);
  const columns: Columns = {};
  for (const key of Object.keys(NAMES) as Column[]) {
    // the first name in the list that a heading has wins, so "Total Owed" beats "Unit Price"
    for (const name of NAMES[key]) {
      const at = normal.indexOf(name);
      if (at >= 0) {
        columns[key] = at;
        break;
      }
    }
  }
  const missing = (["id", "date", "name"] as Column[]).filter((k) => columns[k] === undefined);
  if (columns.total === undefined && columns.unit === undefined) missing.push("total");
  return { columns, missing };
}

/** `12.99`, `12,99`, `1.234,56`, `1,234.56`, `€ 12,99`, `-5` as cents; null when it is not an amount. */
export function parseAmount(text: string): number | null {
  const t = text.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(t)) return null;
  const negative = t.startsWith("-");
  const digits = t.replace(/-/g, "");
  const lastDot = digits.lastIndexOf(".");
  const lastComma = digits.lastIndexOf(",");
  const last = Math.max(lastDot, lastComma);
  let whole = digits;
  let frac = "";
  if (last >= 0) {
    const after = digits.length - last - 1;
    // the last separator is the decimal one when 1 or 2 digits follow it, or when the other kind also occurs and it comes last
    const other = lastDot >= 0 && lastComma >= 0;
    if (after >= 1 && after <= 2) {
      whole = digits.slice(0, last);
      frac = digits.slice(last + 1);
    } else if (other) return null;
  }
  const w = whole.replace(/[.,]/g, "");
  if (!/^\d*$/.test(w) || (w === "" && frac === "")) return null;
  const cents = Number(w || "0") * 100 + Number((frac + "00").slice(0, 2));
  if (!Number.isFinite(cents) || cents > 100_000_000) return null;
  return negative ? -cents : cents;
}

/** A day (`YYYY-MM-DD`) from `2023-04-17T09:21:33Z` (the local day of that moment), `2023-04-17`, `17.04.2023` or `17/04/2023`. */
export function parseDay(text: string, offsetMinutes?: number): string | null {
  const t = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(t);
  if (iso) {
    if (iso[4] === undefined) return valid(+iso[1], +iso[2], +iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
    return localStamp(t.includes("T") ? t : t.replace(" ", "T"), offsetMinutes)?.date ?? null;
  }
  const dmy = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(t);
  if (dmy && valid(+dmy[3], +dmy[2], +dmy[1])) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return null;
}

function valid(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "Amazon.de" is "Amazon"; a name that is not an address stays as it is. */
export function shopFromWebsite(text: string): string {
  const t = text.trim().replace(/^https?:\/\//i, "").replace(/^www\./i, "").split("/")[0];
  const m = /^([a-z0-9-]+)\.(?:[a-z]{2,3}|co\.[a-z]{2})$/i.exec(t);
  const name = m ? m[1] : t;
  return name ? name.charAt(0).toUpperCase() + name.slice(1) : "";
}

export type OrderInput = {
  id: string;
  date: string;
  time: null;
  store: null;
  total_cents: number;
  lines: { name: string; quantity: number; total_cents: number }[];
};

export type OrderFile = {
  /** The shop named in the file's website column, when there is one. */
  shop: string | null;
  orders: OrderInput[];
  /** Why rows were left out, with how many. */
  skipped: { noId: number; noDate: number; noAmount: number; otherCurrency: number; cancelled: number; tooLong: number };
  first: string | null;
  last: string | null;
};

export type ReadResult = { ok: true; file: OrderFile } | { ok: false; reason: string };

const CANCELLED = /cancel|storn|annul/i;

/** The orders of a CSV text: rows with the same order number become one order. */
export function readOrders(text: string, offsetMinutes?: number): ReadResult {
  const rows = parseCsv(text);
  if (rows.length < 2) return { ok: false, reason: "The file has no rows." };
  const { columns, missing } = detectColumns(rows[0]);
  if (missing.length > 0) {
    const names: Record<Column, string> = { id: "order number", date: "order date", name: "product name", total: "amount", qty: "quantity", unit: "unit price", currency: "currency", status: "status", shop: "shop" };
    return { ok: false, reason: `This does not look like an order list: no column for ${missing.map((m) => names[m]).join(", ")}. The headings in the file are: ${rows[0].map((h) => h.trim()).filter(Boolean).slice(0, 12).join(", ")}.` };
  }
  const get = (r: string[], k: Column) => (columns[k] === undefined ? "" : (r[columns[k] as number] ?? "").trim());
  const skipped = { noId: 0, noDate: 0, noAmount: 0, otherCurrency: 0, cancelled: 0, tooLong: 0 };
  const byId = new Map<string, OrderInput>();
  const shops = new Map<string, number>();
  for (const r of rows.slice(1)) {
    const id = get(r, "id").slice(0, 100);
    if (!id || !/^[A-Za-z0-9_.:-]+$/.test(id)) {
      skipped.noId++;
      continue;
    }
    const date = parseDay(get(r, "date"), offsetMinutes);
    if (!date) {
      skipped.noDate++;
      continue;
    }
    if (CANCELLED.test(get(r, "status"))) {
      skipped.cancelled++;
      continue;
    }
    const currency = get(r, "currency");
    if (currency && currency.toUpperCase() !== "EUR") {
      skipped.otherCurrency++;
      continue;
    }
    const name = get(r, "name").slice(0, 200);
    const qtyRaw = Number(get(r, "qty"));
    const quantity = Number.isInteger(qtyRaw) && qtyRaw >= 1 && qtyRaw <= 99 ? qtyRaw : 1;
    const total = columns.total !== undefined ? parseAmount(get(r, "total")) : null;
    const unit = columns.unit !== undefined ? parseAmount(get(r, "unit")) : null;
    const cents = total ?? (unit !== null ? unit * quantity : null);
    if (!name || cents === null) {
      skipped.noAmount++;
      continue;
    }
    const shop = get(r, "shop");
    if (shop) shops.set(shop, (shops.get(shop) ?? 0) + 1);
    let order = byId.get(id);
    if (!order) {
      order = { id, date, time: null, store: null, total_cents: 0, lines: [] };
      byId.set(id, order);
    }
    if (order.lines.length >= 200) {
      skipped.tooLong++;
      continue;
    }
    order.lines.push({ name, quantity, total_cents: cents });
    order.total_cents += cents;
  }
  const orders = [...byId.values()].filter((o) => o.lines.length > 0).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const top = [...shops.entries()].sort((a, b) => b[1] - a[1])[0];
  return {
    ok: true,
    file: { shop: top ? shopFromWebsite(top[0]) || null : null, orders, skipped, first: orders.length ? orders[orders.length - 1].date : null, last: orders.length ? orders[0].date : null },
  };
}

/** One sentence saying what was found, for the preview. */
export function previewText(f: OrderFile): string {
  const lines = f.orders.reduce((n, o) => n + o.lines.length, 0);
  const left = Object.values(f.skipped).reduce((a, b) => a + b, 0);
  const parts = [`${f.orders.length} order${f.orders.length === 1 ? "" : "s"} with ${lines} line${lines === 1 ? "" : "s"}`];
  if (f.first && f.last) parts.push(f.first === f.last ? f.first : `${f.first} to ${f.last}`);
  const why: string[] = [];
  if (f.skipped.cancelled) why.push(`${f.skipped.cancelled} cancelled`);
  if (f.skipped.otherCurrency) why.push(`${f.skipped.otherCurrency} not in euro`);
  if (f.skipped.noAmount) why.push(`${f.skipped.noAmount} without an amount`);
  if (f.skipped.noDate) why.push(`${f.skipped.noDate} without a readable date`);
  if (f.skipped.noId) why.push(`${f.skipped.noId} without an order number`);
  if (f.skipped.tooLong) why.push(`${f.skipped.tooLong} lines over the limit of an order`);
  return `${parts.join(", ")}${left > 0 ? `; left out: ${why.join(", ")}` : ""}.`;
}
